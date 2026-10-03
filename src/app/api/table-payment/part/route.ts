import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { planBlocks } from "@/lib/plan-guard";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { tableOutstanding } from "@/lib/table-outstanding";
import { applyPayment } from "@/lib/table-balance";
import { addTip, closeBill, record, sittingFor, summary } from "@/lib/part-payment";

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
  }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const method = body.method;
  // `ref` is the caller's name for THIS collection, reused on every retry of
  // it. Without one, a button tapped twice on a phone with a bad signal is two
  // payments, the bill reads as covered, and the difference walks out.
  const ref = typeof body.ref === "string" ? body.ref.trim().slice(0, 100) : "";
  if (!body.tableId || !["cash", "card"].includes(method ?? "") || !ref) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const before = await tableOutstanding(actor.restaurantId, body.tableId);
  if (before.owed <= 0) return await apiError("apiErr.nothingToSettle", 409);

  // Both are capped, and by different things. The amount is capped at what is
  // owed, so a waiter typing 1000 for 100 does not leave a bill owing minus
  // MX$900. The tip is capped at the amount actually being collected — the
  // ceiling every other tip in the app has, because a mistyped MX$50 gratuity
  // on a MX$20 collection is cash somebody has to explain at the end of the
  // night.
  //
  // This comment used to say the tip was not capped. It has been capped since
  // `applyPayment` was written, and the line below is the one that does it —
  // so a diner settling the last MX$10 of a table and leaving MX$60 for the
  // staff is recorded as tipping MX$10, and the rest belongs on the whole-table
  // settle instead, where the ceiling is the whole bill.
  const taken = applyPayment(before.owed, Number(body.amount), Number(body.tip));
  if (taken.amount <= 0) return await apiError("apiErr.invalidRequest", 400);

  const sessionId = await sittingFor(actor, body.tableId, before);
  if (!sessionId) return await apiError("apiErr.nothingToSettle", 409);

  const { wrote, refused, covered, landed } = await record(actor, before, sessionId, taken, method!, ref);

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
  // the collection that did land, and everything after still runs: the first
  // attempt may have been cut off before it closed the bill.
  // The gratuity follows the food it thanks somebody for, so it is clamped to
  // what actually landed rather than to what was typed: a colleague collecting
  // the same table first leaves less room than this request read.
  const tipLanded = Math.min(taken.tip, landed);
  if (wrote && tipLanded > 0) await addTip(actor.restaurantId, before, tipLanded);

  const after = await tableOutstanding(actor.restaurantId, body.tableId);
  const settled = after.owed <= 0 && (await closeBill(actor, body.tableId, method!));

  if (wrote) {
    await logEvent({
      restaurantId: actor.restaurantId,
      actor: actor.email,
      entity: "bill",
      action: settled ? "paid" : "collected",
      detail: logDetail({
        table: before.orders[0]?.table_label,
        // What went into the ledger, not what was asked for. The two differ
        // when somebody else was collecting on the same table at the same
        // moment, and the log is the record a cashier signs for.
        amount: landed.toFixed(2),
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
  if (!wrote && !refused) return await apiError("apiErr.generic", 500);

  return NextResponse.json({
    ok: true,
    settled,
    duplicate: refused,
    ...summary(after),
  });
}
