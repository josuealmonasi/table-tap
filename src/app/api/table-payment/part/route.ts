import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingFrontOfHouse, type Actor } from "@/lib/api-guard";
import { planBlocks } from "@/lib/plan-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { recordPayment } from "@/lib/payments";
import { closeSessionsFor, openSession } from "@/lib/table-session";
import { tableOutstanding, type Outstanding } from "@/lib/table-outstanding";
import { applyPayment, shareOut } from "@/lib/table-balance";
import { round2 } from "@/lib/money";

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

  const body = (await req.json()) as {
    tableId?: string;
    amount?: number;
    tip?: number;
    method?: "cash" | "card";
    ref?: string;
  };
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

  // Capped at what is owed: a waiter typing 1000 for 100 must not leave a bill
  // owing minus MX$900. The tip is not capped — it is the diner's own.
  const taken = applyPayment(before.owed, Number(body.amount), Number(body.tip));
  if (taken.amount <= 0) return await apiError("apiErr.invalidRequest", 400);

  const sessionId = await sittingFor(actor, body.tableId, before);
  if (!sessionId) return await apiError("apiErr.nothingToSettle", 409);

  const wrote = await record(actor, before, sessionId, taken, method!, ref);

  // `wrote` is false when the database refused this as a copy of a collection
  // already recorded — a button tapped twice, or a request retried when the
  // signal came back. The money is in the ledger once, which is right: the tip
  // must not land a second time and neither must the log line. Everything
  // after that still runs, because the first attempt may have been cut off
  // before it closed the bill.
  if (wrote && taken.tip > 0) await addTip(actor.restaurantId, before, taken.tip);

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
        amount: taken.amount.toFixed(2),
        method,
        left: settled ? null : after.owed.toFixed(2),
      }),
    });
  }

  return NextResponse.json({
    ok: true,
    settled,
    duplicate: !wrote,
    ...summary(after),
  });
}

/**
 * Write the collection down, against the sittings it actually pays for.
 *
 * A table can owe on more than one: an old sitting expires with something
 * still on it and the next party opens another, and the waiter settling that
 * table is settling both. The money is one handful of notes, but a payment
 * belongs to a sitting — recording all of it against one leaves that sitting
 * holding money it did not owe and the other marked paid with nothing behind
 * it. Both of those turned up on a real table.
 *
 * Each row carries its own reference, so the guard against a double tap still
 * refuses the whole collection rather than half of it.
 *
 * @returns whether anything was written. False for a copy the database
 * refused, which the caller must know about: the tip must not land twice.
 */
async function record(
  actor: Actor,
  before: Outstanding,
  fallback: string,
  taken: { amount: number; tip: number },
  method: "cash" | "card",
  ref: string,
): Promise<boolean> {
  // The first sitting is credited with the gratuity it is ABOUT to receive:
  // `addTip` puts it on the oldest order a moment from now, and splitting the
  // money against totals that do not include it yet spills the tip into the
  // next sitting's share — which then reads as money it never owed.
  const owedNow = before.sittings.map((sitting, n) =>
    n === 0 ? { ...sitting, owed: round2(sitting.owed + taken.tip) } : sitting,
  );

  // `sittings` is empty only when nothing owed had one, and `sittingFor` has
  // just given them all the same new one. And if the split somehow comes back
  // with nothing, the whole amount goes on the fallback rather than nowhere:
  // money that has changed hands is recorded somewhere, always.
  const split = owedNow.length > 0 ? shareOut(taken.amount, owedNow) : [];
  const across = split.length > 0 ? split : [{ id: fallback, amount: taken.amount }];

  let wrote = false;
  for (const [n, share] of across.entries()) {
    const landed = await recordPayment({
      restaurantId: actor.restaurantId,
      // The sitting, not an order: this money belongs to the table, and
      // pinning it to one of the orders would say that dish was paid for when
      // what was handed over covers a share of all of them.
      sessionId: share.id,
      amount: share.amount,
      // The gratuity rides with the first share, which is the oldest sitting —
      // the same one whose order `addTip` puts it on.
      tip: n === 0 ? taken.tip : 0,
      method,
      actorEmail: actor.email,
      clientRef: n === 0 ? ref : `${ref}#${n}`,
    });
    wrote = wrote || landed;
  }
  return wrote;
}

/** What the calculator needs back: the numbers, not the rows or the sittings. */
function summary(now: Outstanding): Omit<Outstanding, "orders" | "sittings"> {
  return { ordered: now.ordered, owed: now.owed, collected: now.collected, tips: now.tips };
}

/**
 * The sitting this collection belongs to.
 *
 * Normally the one the table's unpaid orders are already on. Orders old enough
 * to predate sittings have none, and a payment recorded against a sitting no
 * order refers to would be invisible to the balance — the waiter would collect
 * the same bill forever. So when NOTHING owed on the table has a sitting, one
 * is opened and they all join it. Only then: a table where some orders have a
 * sitting has a party at it, and moving a stray debt into their bill would put
 * the last party's food in front of them.
 */
async function sittingFor(
  actor: Actor,
  tableId: string,
  before: Outstanding,
): Promise<string | null> {
  const known = before.orders.find(o => o.session_id)?.session_id;
  if (known) return known;

  const opened = await openSession(actor.restaurantId, tableId);
  if (!opened) return null;
  await createAdminClient()
    .from("orders")
    .update({ session_id: opened })
    .eq("restaurant_id", actor.restaurantId)
    .eq("table_id", tableId)
    .is("session_id", null)
    .eq("paid", false)
    .eq("written_off", false);
  return opened;
}

/**
 * The gratuity, onto the oldest order still owed.
 *
 * The same attribution settling a whole table already uses: `tip` and `total`
 * both rise, so the takings match what actually changed hands. The balance is
 * unmoved because it counts `total` minus `tip` — which is the one reason
 * both columns have to move together.
 */
async function addTip(restaurantId: string, before: Outstanding, tip: number): Promise<void> {
  const first = before.orders[0];
  if (!first) return;
  await createAdminClient()
    .from("orders")
    .update({
      tip: round2(Number(first.tip ?? 0) + tip),
      total: round2(Number(first.total ?? 0) + tip),
    })
    .eq("id", first.id)
    .eq("restaurant_id", restaurantId);
}

/**
 * Nothing left to collect: the orders stop being owed and the table clears.
 *
 * No payment is recorded here — every centavo of this bill is already in the
 * ledger against the sitting. Recording the orders as well is how a table that
 * paid MX$200 comes to show MX$400 in the day's takings.
 */
async function closeBill(
  actor: Actor,
  tableId: string,
  method: "cash" | "card",
): Promise<boolean> {
  const db = createAdminClient();
  const { data: cleared } = await db
    .from("orders")
    .update({ paid: true, pay_method: method })
    .eq("restaurant_id", actor.restaurantId)
    .eq("table_id", tableId)
    .eq("paid", false)
    .eq("written_off", false)
    .neq("status", "pending_payment")
    .neq("status", "cancelled")
    .select("session_id");

  await closeSessionsFor(cleared ?? [], "settled");

  // Settled, so any open ask to come and settle it is answered.
  await db
    .from("service_requests")
    .update({ status: "done" })
    .eq("restaurant_id", actor.restaurantId)
    .eq("table_id", tableId)
    .eq("kind", "pay")
    .eq("status", "open");

  return true;
}
