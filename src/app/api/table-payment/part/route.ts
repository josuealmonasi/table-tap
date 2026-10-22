import { PaymentAttributionRequired } from "@/lib/payment-coverage";
import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { planBlocks } from "@/lib/plan-guard";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { tableOutstanding } from "@/lib/table-outstanding";
import { applyPayment } from "@/lib/table-balance";
import { recordReviewed } from "@/lib/reviewed-collection";
import { closeBill, summary } from "@/lib/part-payment";
import { isDinerCurrency } from "@/lib/diner-currency";
import { formatMoney } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * POST /api/table-payment/part — the waiter collects part of a table's bill.
 *
 * The calculator behind the waiter's pad. A table of three where one pays
 * MX$100 and the others MX$50 each is an ordinary Tuesday in a Mexican
 * restaurant, and until now the app could only take the whole bill at once or
 * freeze it into equal shares the diners claimed on their own phones.
 *
 * Each collection is subtracted from what the table owes; the bill closes when
 * the FOOD reaches zero. Tips do not move that balance — they accumulate onto
 * the order the way settling a whole table already does — so a diner leaving
 * 15% never makes the table look nearer to settled than it is.
 *
 * Front of house only. This says money arrived without any of it passing
 * through us, so it must not be reachable from a diner's phone or a kitchen
 * screen sitting open on the pass.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try { return await collect(req); }
  catch (error) {
    if (error instanceof PaymentAttributionRequired) return await apiError("apiErr.attributionRequired", 409);
    throw error;
  }
}

async function collect(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  // Plan-gated, deliberately not frozen: a lapsed subscription is between us
  // and the owner, and must not reach into a waiter collecting from a table
  // that is sitting there. Settling in full stays available whatever happens.
  const blocked = await planBlocks(actor.restaurantId, "waiterService");
  if (blocked) return blocked;

  const body = await jsonBody<{
    tableId?: string;
    amount?: number;
    tip?: number;
    method?: "cash" | "card";
    ref?: string;
    expected?: number;
    currency?: string;
  }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const method = body.method;
  // `ref` is the caller's name for THIS collection, reused on every retry of
  // it. Without one, a button tapped twice on a phone with a bad signal is two
  // payments, the bill reads as covered, and the difference walks out.
  const ref = typeof body.ref === "string" ? body.ref.trim().slice(0, 100) : "";
  // A tab opened before the reviewed balance shipped sends neither the
  // balance it showed nor its currency. Refusing it as an invalid request
  // left a waiter holding the customer's cash. It collects as it always did,
  // against the live balance in the table's one currency; the stale-balance
  // check needs the figure the screen showed, so it starts at the next refresh.
  //
  // Only in the menu's currency, because that is the one that tab showed every
  // figure in. A table owing only dollars at a peso restaurant would otherwise
  // take the MX$100 the waiter typed as US$100 and clear the dollar debt
  // (audit L, finding 2). Any other currency refreshes first.
  if (body.expected === undefined && body.currency === undefined && typeof body.tableId === "string") {
    const live = await tableOutstanding(actor.restaurantId, body.tableId);
    const owing = (live.balances ?? []).filter(b => b.owed > 0);
    if (owing.length > 1) return await apiError("apiErr.refreshToCollect", 409);
    if (owing.length === 0 && live.owed <= 0) return await apiError("apiErr.nothingToSettle", 409);
    const currency = owing[0]?.currency ?? live.currency ?? undefined;
    const { data: menu } = await createAdminClient()
      .from("restaurants").select("currency").eq("id", actor.restaurantId).maybeSingle();
    if (!menu?.currency || currency !== menu.currency) return await apiError("apiErr.refreshToCollect", 409);
    body.currency = currency;
    body.expected = owing[0]?.owed ?? live.owed;
  }
  if (!body.tableId || !["cash", "card"].includes(method ?? "") || !ref ||
      !Number.isFinite(body.expected) || Number(body.expected) <= 0 || !isDinerCurrency(body.currency) ||
      !Number.isFinite(body.amount) || Number(body.amount) <= 0 || !Number.isFinite(body.tip ?? 0)) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const before = await tableOutstanding(actor.restaurantId, body.tableId, body.currency);

  // Both are capped, and by different things. The amount is capped at what is
  // owed, so a waiter typing 1000 for 100 does not leave a bill owing minus
  // MX$900. The tip is capped at the amount actually being collected — the
  // ceiling every other tip in the app has, because a mistyped MX$50 gratuity
  // on a MX$20 collection is cash somebody has to explain at the end of the
  // night.
  //
  // This comment used to say the tip was not capped. It has been capped since
  // `applyPayment` was written, and the line below is the one that does it —
  // so the screen shares that calculation. An oversized gratuity is refused
  // before collecting; silently reducing cash already offered loses money.
  const taken = applyPayment(Number(body.expected), Number(body.amount), Number(body.tip ?? 0));
  if (Number(body.tip ?? 0) > taken.food) return await apiError("apiErr.collectionTipLimit", 400, { max: formatMoney(taken.food, body.currency) });
  if (Number(body.amount) > Number(body.expected)) return await apiError("apiErr.invalidRequest", 400);
  if (taken.amount <= 0) return await apiError("apiErr.invalidRequest", 400);

  // Legacy sitting attachment also belongs to the reviewed transaction.
  const result = await recordReviewed(actor, { tableId: body.tableId, expected: Number(body.expected), currency: body.currency }, taken.amount, taken.tip, method!, ref);
  const { wrote, refused, covered, landed } = result;
  if (result.paying) return await apiError("apiErr.accountBillPaying", 409);
  if (result.changed) return await apiError("apiErr.collectionBalanceChanged", 409,
    { owed: formatMoney(result.owed ?? before.owed, body.currency) }, { owed: result.owed, currency: body.currency, code: "balance_changed" });
  // A failed batch recorded nothing. Do not close the bill or hide this error
  // behind a later read: the waiter holding the cash needs to retry this tap.
  if (!wrote && !refused && !covered) return await apiError("apiErr.collectionFailed", 500);

  // `wrote` is false when nothing new reached the ledger. That has two causes
  // and they are not the same thing:
  //
  //   `refused` — the database turned it down as a copy of a collection
  //   already recorded: a button tapped twice, or a request retried when the
  //   signal came back. The money IS in the ledger, once, which is right.
  //
  //   neither — the insert failed for some other reason and the money is
  //   nowhere. Reporting that as `duplicate` told a waiter holding the cash
  //   that it was already recorded, which is the one thing it must never say.
  //
  // Either way the tip and the log line are skipped, because both belong to
  // the collection that did land. A duplicate still retries closing the bill:
  // the first attempt may have been cut off before it closed it.
  // The gratuity follows the food it thanks somebody for. A colleague
  // collecting first now refuses the whole attempt: the waiter must check
  // the cash and change, rather than have a smaller receipt silently recorded.
  // Every sitting and its tip commit together in collect_table_reviewed_v1.

  const after = await tableOutstanding(actor.restaurantId, body.tableId, body.currency);
  const cleared = after.owed <= 0 && (await closeBill(actor, body.tableId, method!, body.currency));
  const remaining = cleared ? await tableOutstanding(actor.restaurantId, body.tableId) : null;
  const settled = cleared && !(remaining?.balances?.some(b => b.owed > 0) ?? (remaining?.owed ?? 0) > 0);

  if (wrote) {
    await logEvent({
      restaurantId: actor.restaurantId,
      actor: actor.email,
      entity: "bill",
      action: settled ? "paid" : "collected",
      detail: logDetail({
        table: before.orders[0]?.table_label,
        // What went into the ledger: a retry returns its original receipt,
        // and the log is the record a cashier signs for. A competing
        // collection now refuses rather than quietly recording less.
        amount: landed.toFixed(2),
        tip: result.tip.toFixed(2),
        currency: body.currency,
        method,
        left: settled ? null : after.owed.toFixed(2),
      }),
    });
  }

  // Nothing landed because the bill was already covered — a colleague
  // collecting the same table a moment sooner. The same answer this route
  // gives when it reads a settled bill up front, because it is the same fact,
  // learned later.
  if (covered && !wrote && !refused) {
    return await apiError("apiErr.nothingToSettle", 409);
  }

  // Nothing landed and it was neither a duplicate nor a covered bill: say so
  // rather than dressing a failure up as a collection that already happened.
  if (!wrote && !refused) return await apiError("apiErr.collectionFailed", 500);

  return NextResponse.json({
    ok: true,
    settled,
    duplicate: refused,
    amount: landed,
    tip: result.tip ?? taken.tip,
    currency: body.currency,
    ...summary(after),
  });
}
