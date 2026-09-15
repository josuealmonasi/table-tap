import { createAdminClient } from "@/lib/supabase/admin";
import { fetchTableBill } from "@/lib/bill-data";
import { tableBill } from "@/lib/table-bill";
import { sharesFor } from "@/lib/split";
import { round2 } from "@/lib/money";

/**
 * The server's side of dividing a bill.
 *
 * SERVER-ONLY: every read here uses the secret key, because the only thing
 * identifying a diner is a sitting id and a token their own phone made up.
 * Neither is a login, so nothing a browser sends is believed: what the table
 * owes is always summed from the stored orders.
 */

export interface SplitState {
  id: string;
  shares: number;
  status: "proposed" | "locked" | "cancelled" | "done";
  /** Frozen when the last person joined; zero while it is still a proposal. */
  amount: number;
  proposedBy: string;
  joined: number;
  /** This diner's seat, or null if they have not taken one. */
  mine: { shareNo: number; amount: number; paid: boolean } | null;
  /** What the table owes right now — what a proposal WOULD divide. */
  outstanding: number;
  /** Their own orders placed after it froze, which are theirs alone. */
  ownSince: number;
}

/**
 * Is this table in the middle of dividing its bill?
 *
 * The question every route that settles a WHOLE bill has to ask, for the same
 * reason it asks about a waiter: two ways of paying, disagreeing about the
 * amount, is how a table pays twice.
 *
 * Three phones ordered; two of them agreed to halve it and it froze. The third
 * never joined, so its screen never hid the whole-bill button — and nothing on
 * the server refused it. Both halves paid, and the whole bill paid: one dinner,
 * charged twice.
 *
 * Asked of the sittings the table's UNPAID orders belong to, which is exactly
 * the set those routes would charge for — the same shape as `staffOpenedBill`,
 * and for the same reason: the sitting that is open right now is too narrow.
 */
export async function splitInProgress(
  restaurantId: string,
  tableId: string,
): Promise<boolean> {
  const db = createAdminClient();
  const { data: owed } = await db
    .from("orders")
    .select("session_id")
    .eq("restaurant_id", restaurantId)
    .eq("table_id", tableId)
    .eq("paid", false)
    .eq("written_off", false)
    .neq("status", "pending_payment")
    .neq("status", "cancelled");

  const sessions = [...new Set((owed ?? []).map(o => o.session_id).filter(Boolean))] as string[];
  if (sessions.length === 0) return false;

  const { count } = await db
    .from("bill_splits")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .in("session_id", sessions)
    .eq("status", "locked");
  return (count ?? 0) > 0;
}

/**
 * Closes any live division of this sitting's bill.
 *
 * Called when the money stops being outstanding some other way — the waiter
 * took cash, the floor wrote it off. A split left locked over a bill that is
 * already gone is a charge waiting to happen: `/api/split/pay` bills the share
 * frozen at the lock, and it has no idea the table has settled.
 */
export async function endSplitsFor(sessionId: string): Promise<void> {
  await createAdminClient()
    .from("bill_splits")
    .update({ status: "done" })
    .eq("session_id", sessionId)
    .in("status", ["proposed", "locked"]);
}

/** The live proposal or lock for a sitting, if there is one. */
export async function currentSplit(
  sessionId: string,
  diner: string,
  restaurantId: string,
  tableId: string,
  /**
   * The orders this phone says are its own.
   *
   * Which order belongs to which diner is knowledge only the phone has — there
   * are no accounts at a table. Passed in and then checked against the sitting,
   * because without it every diner was shown everybody else's later round: one
   * person ordering a beer raised the bill of everyone who had already agreed.
   */
  ownOrderIds: string[] = [],
): Promise<SplitState | null> {
  const db = createAdminClient();
  const { data: split } = await db
    .from("bill_splits")
    .select("id, shares, status, amount, proposed_by, locked_at, expires_at")
    .eq("session_id", sessionId)
    .in("status", ["proposed", "locked"])
    .maybeSingle();
  if (!split) return null;

  // A proposal nobody finished is not a proposal any more.
  if (split.status === "proposed" && new Date(split.expires_at) < new Date()) {
    await db.from("bill_splits").update({ status: "cancelled" }).eq("id", split.id);
    return null;
  }

  const { data: claims } = await db
    .from("bill_split_claims")
    .select("share_no, diner, amount, paid_at")
    .eq("split_id", split.id);

  const mine = (claims ?? []).find(c => c.diner === diner);
  const orders = await fetchTableBill(restaurantId, tableId, "diner", sessionId);
  const bill = tableBill(orders, []);

  return {
    id: split.id,
    shares: split.shares,
    status: split.status,
    amount: Number(split.amount),
    proposedBy: split.proposed_by,
    joined: claims?.length ?? 0,
    mine: mine
      ? { shareNo: mine.share_no, amount: Number(mine.amount), paid: Boolean(mine.paid_at) }
      : null,
    outstanding: bill.total,
    ownSince: split.locked_at
      ? ownOrdersSince(orders, split.locked_at as string, ownOrderIds)
      : 0,
  };
}

/**
 * What this diner ordered after the table agreed.
 *
 * Summed from the orders themselves rather than trusted from the phone, and
 * only the ones placed after the freeze: everything before it went into the pot
 * the table divided.
 */
function ownOrdersSince(
  orders: { id: string; created_at: string; total: number | string; paid?: boolean }[],
  lockedAt: string,
  ownOrderIds: string[],
): number {
  const mine = new Set(ownOrderIds);
  // Parsed, not compared as text. Postgres hands back "+00:00" where JavaScript
  // writes "Z", so two instants a second apart can sort the wrong way round as
  // strings — which had every order on the table counted as ordered afterwards,
  // and each diner's share quietly doubled.
  const froze = Date.parse(lockedAt);
  return round2(
    orders
      .filter(o => mine.has(o.id) && !o.paid && Date.parse(o.created_at) > froze)
      .reduce((sum, o) => sum + Number(o.total), 0),
  );
}

/**
 * Freeze the amounts once everybody is in.
 *
 * The share list comes from the pure module, so the odd cent lands on the
 * proposer — seat zero, which is theirs by construction.
 */
export async function writeShares(splitId: string, amount: number, shares: number): Promise<void> {
  const db = createAdminClient();
  const amounts = sharesFor(amount, shares);
  const { data: claims } = await db
    .from("bill_split_claims")
    .select("share_no")
    .eq("split_id", splitId);

  for (const claim of claims ?? []) {
    await db
      .from("bill_split_claims")
      .update({ amount: amounts[claim.share_no] ?? 0 })
      .eq("split_id", splitId)
      .eq("share_no", claim.share_no);
  }
}
