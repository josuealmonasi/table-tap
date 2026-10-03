import { createAdminClient } from "@/lib/supabase/admin";
import type { Actor } from "@/lib/api-guard";
import { closeSessionsFor, openSession } from "@/lib/table-session";
import { endSplitsFor } from "@/lib/split-service";
import { type Outstanding } from "@/lib/table-outstanding";
import { shareOut } from "@/lib/table-balance";
import { round2 } from "@/lib/money";

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
 * @returns `wrote` — something new reached the ledger — `refused`, which says a
 * row was turned down as a copy of one already there, and `landed`, the amount
 * that ACTUALLY went down. Both flags false means the insert failed outright
 * and the money is nowhere, which is a different answer from "already
 * recorded" and must not be reported as one.
 *
 * `landed` can be less than what was asked for: the sitting is re-read under a
 * lock and the share capped against what is genuinely still owed, so a waiter
 * typing MX$200 while a colleague takes MX$150 of it records the MX$50 that is
 * really left rather than a second MX$200.
 */
export async function record(
  actor: Actor,
  before: Outstanding,
  fallback: string,
  taken: { amount: number; tip: number },
  method: "cash" | "card",
  ref: string,
): Promise<{ wrote: boolean; refused: boolean; covered: boolean; landed: number }> {
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

  // Each share goes down under a lock on its own sitting, where what is owed
  // is read live. The balance this request started from is already stale by
  // now if anybody else is collecting on the same table — which is how two
  // waiters took MX$400 for a MX$200 dinner.
  const db = createAdminClient();
  let wrote = false;
  let refused = false;
  let covered = false;
  let landedTotal = 0;
  for (const [n, share] of across.entries()) {
    const { data } = await db.rpc("collect_on_sitting", {
      // The sitting, not an order: this money belongs to the table, and
      // pinning it to one of the orders would say that dish was paid for when
      // what was handed over covers a share of all of them.
      p_restaurant: actor.restaurantId,
      p_session: share.id,
      p_amount: share.amount,
      // The gratuity rides with the first share, which is the oldest sitting —
      // the same one whose order `addTip` puts it on.
      p_tip: n === 0 ? taken.tip : 0,
      p_method: method,
      p_actor: actor.email,
      p_ref: n === 0 ? ref : `${ref}#${n}`,
    });
    const outcome = (data as { taken?: number; outcome?: string } | null) ?? {};
    if (outcome.outcome === "written") {
      wrote = true;
      landedTotal = round2(landedTotal + Number(outcome.taken ?? 0));
    } else if (outcome.outcome === "duplicate") {
      refused = true;
    } else if (outcome.outcome === "covered") {
      // Somebody else was collecting on this table and got there first. Not an
      // error and not a duplicate — there is simply nothing left to take.
      covered = true;
    }
  }

  // Money taken at the table ends any division of that bill — AFTER the money
  // is down, not before.
  //
  // A share is the figure frozen when the table agreed, and nothing about it
  // moves again: the sitting stays open after a PART of the bill is collected
  // — `close_session_if_clear` only closes when the whole thing is covered —
  // so every share stayed chargeable at its original amount. MX$200 halved,
  // MX$120 handed over at the table, both halves still payable by card:
  // MX$320 collected for a MX$200 dinner.
  //
  // Ended rather than recalculated. The diners agreed to divide THIS bill and
  // a different number is not the thing they agreed to — their screens go back
  // to the plain bill, showing what is actually left, with the person who just
  // took the cash standing in front of them.
  //
  // It ran first, which made it an irreversible change ahead of the thing it
  // is supposed to follow: an insert that failed for any reason other than a
  // duplicate left the table's split ended and no money recorded. A retry is
  // the exception and still ends it, because on a retry the first attempt
  // already collected.
  if (wrote || refused) {
    for (const share of across) await endSplitsFor(share.id);
  }

  return { wrote, refused, covered, landed: landedTotal };
}

/** What the calculator needs back: the numbers, not the rows or the sittings. */
export function summary(now: Outstanding): Omit<Outstanding, "orders" | "sittings"> {
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
export async function sittingFor(
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
    .is("account_id", null)
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
export async function addTip(restaurantId: string, before: Outstanding, tip: number): Promise<void> {
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
 * paid MX$200 comes to show MX$400 in the day's takings. So `settle_orders` is
 * given no sittings to record against, and only marks the orders paid.
 *
 * It answered "settled" whatever happened: a failed write left the orders owed
 * while the waiter was told the table was clear. Now a failure is "not
 * settled", the bill stays open at MX$0 owing, and "Pagó en efectivo" closes it.
 */
export async function closeBill(
  actor: Actor,
  tableId: string,
  method: "cash" | "card",
): Promise<boolean> {
  const db = createAdminClient();
  const { data: owed, error: readError } = await db
    .from("orders")
    .select("id, session_id")
    .eq("restaurant_id", actor.restaurantId)
    .eq("table_id", tableId)
    .eq("paid", false)
    .is("account_id", null)
    .eq("written_off", false)
    .neq("status", "pending_payment")
    .neq("status", "cancelled");
  if (readError) {
    console.error("closing a bill paid in parts: could not read it:", readError.message);
    return false;
  }
  // Nothing left unpaid: somebody closed it a moment ago, and it is settled.
  if (!owed?.length) return true;

  const { error } = await db.rpc("settle_orders", {
    p_restaurant: actor.restaurantId,
    p_orders: owed.map(o => o.id),
    p_method: method,
    p_actor: actor.email,
    p_sittings: [],
  });
  if (error) {
    console.error("closing a bill paid in parts failed:", error.message);
    return false;
  }

  await closeSessionsFor(owed, "settled");

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
