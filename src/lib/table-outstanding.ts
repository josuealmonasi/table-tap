import { paymentCoverageDetails } from "@/lib/payment-coverage";
import { everyRow } from "@/lib/paged";
import { createAdminClient } from "@/lib/supabase/admin";
import { unpaidOrders } from "@/lib/table-bill";
import { billTotal, type Owes } from "@/lib/table-balance";
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
  /**
   * What each sitting on the table owes, oldest first.
   *
   * A table can owe on more than one: one expires with something still on it
   * and the next party opens another. A payment belongs to a sitting, so a
   * collection covering both has to be shared between them — see `shareOut`.
   */
  sittings: Owes[];
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
  /** The sitting it was recorded against. */
  session: string;
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
  const rows = await everyRow<OwedRow>((a, b) => db.from("orders").select(FIELDS)
    .eq("restaurant_id", restaurantId).eq("table_id", tableId)
    .eq("paid", false).is("account_id", null).eq("written_off", false)
    .neq("status", "pending_payment").order("created_at").order("id").range(a, b), "the open table orders");
  const orders = unpaidOrders(rows);
  const coverage = await paymentCoverageDetails(restaurantId, orders);
  const ordered = billTotal(orders);
  const balances = new Map<string, number>();
  let collected = 0;
  for (const o of orders) {
    const paid = coverage.get(o.id)?.amount ?? 0;
    collected = round2(collected + paid);
    if (o.session_id) balances.set(o.session_id, round2((balances.get(o.session_id) ?? 0) + Number(o.total) - paid));
  }
  return {
    orders, ordered, collected, tips: round2([...coverage.values()].reduce((s, a) => s + a.tip, 0)),
    owed: round2(ordered - collected),
    sittings: [...balances].map(([id, owed]) => ({ id, owed: Math.max(0, owed) })),
  };
}
