import { createAdminClient } from "@/lib/supabase/admin";
import { unpaidOrders } from "@/lib/table-bill";
import { billTotal, paidSoFar, stillOwed } from "@/lib/table-balance";
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
  /** What has already been handed over against the sitting. */
  collected: number;
  /** How much of that was a gratuity. Reference: it is inside `collected`. */
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

/**
 * Payments belonging to a sitting rather than to any one order.
 *
 * A payment carrying an `order_id` was recorded when that order was marked
 * paid, so it left with it — counting it here as well would subtract the same
 * money twice. What is left is what a bill settled in parts is made of: a
 * waiter's collections, and shares of a divided bill.
 */
async function collectedOn(
  restaurantId: string,
  sessionIds: string[],
): Promise<{ amount: number; tip: number }[]> {
  if (sessionIds.length === 0) return [];
  const { data } = await createAdminClient()
    .from("payments")
    .select("amount, tip")
    .eq("restaurant_id", restaurantId)
    .in("session_id", sessionIds)
    .is("order_id", null);
  return (data ?? []).map(p => ({ amount: Number(p.amount), tip: Number(p.tip ?? 0) }));
}

/**
 * @param restaurantId the caller's own restaurant — never taken from the client
 * @param tableId      the table being collected on
 */
export async function tableOutstanding(
  restaurantId: string,
  tableId: string,
): Promise<Outstanding> {
  const { data } = await createAdminClient()
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
  const paid = await collectedOn(restaurantId, sessions);

  return {
    orders: owed,
    ordered: billTotal(owed),
    collected: paidSoFar(paid),
    tips: Number(paid.reduce((sum, p) => sum + p.tip, 0).toFixed(2)),
    owed: stillOwed(owed, paid),
  };
}
