import { paymentCoverageDetails } from "@/lib/payment-coverage";
import { everyRow } from "@/lib/paged";
import { createAdminClient } from "@/lib/supabase/admin";
import { unpaidOrders } from "@/lib/table-bill";
import { billTotal, type Owes } from "@/lib/table-balance";
import { round2 } from "@/lib/money";
import type { Order } from "@/lib/types";
import { dinerCurrency } from "@/lib/diner-currency";

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
  currency?: string | null;
  balances?: { currency: string; ordered: number; collected: number; tips: number; owed: number }[];
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
  currency: string;
  id: string;
  total: number;
  tip: number;
  session_id: string | null;
  table_label: string | null;
}

const FIELDS = "id, total, tip, currency, session_id, table_label, paid, written_off, status";

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
 * @param restaurantId the caller's own restaurant — never taken from the client
 * @param tableId      the table being collected on
 */
export async function tableOutstanding(
  restaurantId: string,
  tableId: string,
  currency?: string,
): Promise<Outstanding> {
  const db = createAdminClient();
  const rows = await everyRow<OwedRow>((a, b) => db.from("orders").select(FIELDS)
    .eq("restaurant_id", restaurantId).eq("table_id", tableId)
    .eq("paid", false).is("account_id", null).eq("written_off", false)
    .neq("status", "pending_payment").order("created_at").order("id").range(a, b), "the open table orders");
  const all = unpaidOrders(rows);
  const orders = currency ? all.filter(o => o.currency === currency) : all;
  const coverage = await paymentCoverageDetails(restaurantId, orders);
  const currencies = [...new Set(orders.map(o => o.currency))];
  const grouped = currencies.map(currency => {
    const own = orders.filter(o => o.currency === currency);
    const ordered = billTotal(own);
    const collected = round2(own.reduce((s, o) => s + (coverage.get(o.id)?.amount ?? 0), 0));
    return { currency, ordered, collected, tips: round2(own.reduce((s, o) => s + (coverage.get(o.id)?.tip ?? 0), 0)), owed: round2(ordered - collected) };
  });
  const ordered = grouped.length > 1 ? 0 : billTotal(orders);
  const balances = new Map<string, number>();
  let collected = 0;
  for (const o of orders) {
    const paid = coverage.get(o.id)?.amount ?? 0;
    collected = round2(collected + paid);
    if (o.session_id) balances.set(o.session_id, round2((balances.get(o.session_id) ?? 0) + Number(o.total) - paid));
  }
  return {
    orders, ordered, collected: grouped.length > 1 ? 0 : collected, tips: grouped.length > 1 ? 0 : round2([...coverage.values()].reduce((s, a) => s + a.tip, 0)),
    currency: currency ?? dinerCurrency(orders), balances: grouped,
    owed: grouped.length > 1 ? 0 : round2(ordered - collected),
    sittings: [...balances].map(([id, owed]) => ({ id, owed: Math.max(0, owed) })),
  };
}
