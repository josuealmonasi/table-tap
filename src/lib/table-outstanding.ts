import { createAdminClient } from "@/lib/supabase/admin";
import { unpaidOrders } from "@/lib/table-bill";
import { billTotal, stillOwed } from "@/lib/table-balance";
import { round2 } from "@/lib/money";
import type { Order } from "@/lib/types";

/**
 * What a table owes right now, with what has already been collected on it
 * subtracted.
 *
 * SERVER-ONLY: reads with the secret key, and every query is scoped by
 * `restaurantId` because that scope is the only thing standing between two
 * tenants once RLS is out of the picture.
 *
 * One reader, used by everything that needs the number: the waiter's dialog,
 * the calculator, and settling the table in full. Two places working out what
 * a table owes is the shape of every money bug this app has had — and here it
 * would be the expensive shape, because the one that thinks less is owed
 * closes the bill and the difference walks out of the door.
 */

/** The unpaid orders, and what has been taken against them so far. */
export interface Outstanding {
  /** Every order still owed for, oldest first. */
  orders: OwedOrder[];
  /** What those orders come to, gratuities included. */
  ordered: number;
  /** Money already in that is still credited to them. */
  collected: number;
  /** Gratuities collected on this sitting. Reference: inside `collected`. */
  tips: number;
  /** Still to collect. */
  owed: number;
}

export interface OwedOrder {
  id: string;
  total: number;
  tip: number;
  session_id: string | null;
  table_label: string | null;
}

const FIELDS = "id, total, tip, session_id, table_label, paid, written_off, status";

/** What the query above hands back, before the cancelled ones are dropped. */
type OwedRow = OwedOrder & Pick<Order, "paid" | "written_off" | "status">;

/** A payment, as this file needs it. */
export interface Paid {
  order_id: string | null;
  amount: number;
  tip: number;
}

/**
 * Money against the sitting that is still credited to what is unpaid.
 *
 * A payment carrying an `order_id` was recorded when that order was marked
 * paid, so it left with it. The rest belongs to the sitting: a waiter's
 * collections, and shares of a divided bill.
 *
 * The subtlety is what happens after a bill closes. Those collections settled
 * the orders they closed, and the orders stay on the sitting — so counting the
 * whole lifetime of a sitting's money against whatever is unpaid NOW would
 * spend the same pesos twice. A table that paid MX$200 and then ordered
 * MX$60 more read as owing nothing.
 *
 * So the money that settled an order is deducted from it: what is left over is
 * what the next round can be paid with, and usually that is everything,
 * because usually nothing has closed yet.
 */
export function creditFor(
  sittingPaid: Paid[],
  settled: { id: string; total: number }[],
  ownPaid: Map<string, number>,
): number {
  const collected = sittingPaid.reduce((sum, p) => sum + p.amount, 0);
  const spent = settled.reduce(
    (sum, o) => sum + Math.max(0, o.total - (ownPaid.get(o.id) ?? 0)),
    0,
  );
  return Math.max(0, round2(collected - spent));
}

/**
 * @param restaurantId the caller's own restaurant — never taken from the client
 * @param tableId      the table being collected on
 */
export async function tableOutstanding(
  restaurantId: string,
  tableId: string,
): Promise<Outstanding> {
  const db = createAdminClient();
  const { data } = await db
    .from("orders")
    .select(FIELDS)
    .eq("restaurant_id", restaurantId)
    .eq("table_id", tableId)
    .eq("paid", false)
    .eq("written_off", false)
    .neq("status", "pending_payment")
    .order("created_at", { ascending: true });

  // The same set the waiter's dialog shows: everything owed on the table, with
  // no window on it. An older debt is theirs to collect or write off, and a
  // bill that hid one is how the floor ended up looking at MX$105 the app said
  // was nothing.
  const owed = unpaidOrders((data ?? []) as OwedRow[]);
  const sessions = [...new Set(owed.map(o => o.session_id).filter(Boolean))] as string[];
  const ordered = billTotal(owed);

  if (sessions.length === 0) {
    return { orders: owed, ordered, collected: 0, tips: 0, owed: ordered };
  }

  // Orders on those sittings that are already settled, and every payment the
  // sittings carry. Both are needed to say how much of the money is still free
  // to pay for what is left.
  const [settledRes, paidRes] = await Promise.all([
    db
      .from("orders")
      .select("id, total")
      .eq("restaurant_id", restaurantId)
      .in("session_id", sessions)
      .eq("paid", true)
      .eq("written_off", false)
      .neq("status", "cancelled")
      .neq("status", "pending_payment"),
    db
      .from("payments")
      .select("order_id, amount, tip")
      .eq("restaurant_id", restaurantId)
      .in("session_id", sessions),
  ]);

  const settled = (settledRes.data ?? []).map(o => ({
    id: o.id as string,
    total: Number(o.total),
  }));
  const payments: Paid[] = (paidRes.data ?? []).map(p => ({
    order_id: (p.order_id as string | null) ?? null,
    amount: Number(p.amount),
    tip: Number(p.tip ?? 0),
  }));

  const ownPaid = new Map<string, number>();
  for (const p of payments) {
    if (!p.order_id) continue;
    ownPaid.set(p.order_id, (ownPaid.get(p.order_id) ?? 0) + p.amount);
  }

  const sittingPaid = payments.filter(p => !p.order_id);
  const credit = creditFor(sittingPaid, settled, ownPaid);
  const tips = round2(sittingPaid.reduce((sum, p) => sum + p.tip, 0));

  return {
    orders: owed,
    ordered,
    collected: credit,
    tips,
    owed: stillOwed(owed, [{ amount: credit, tip: 0 }]),
  };
}
