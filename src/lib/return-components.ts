import type { createAdminClient } from "@/lib/supabase/admin";
import { everyRowIn } from "@/lib/paged";
import { receiptCents as cents } from "@/lib/receipt-amount";

export interface ReturnComponents { total: number; tip: number; service_fee: number }
export interface ReturnAdjustment {
  id: string; order_id: string; currency: string;
  previous_total: number; resulting_total: number;
  previous_tip: number; resulting_tip: number;
  previous_service_fee: number; resulting_service_fee: number;
}

export async function readReturnAdjustments(db: ReturnType<typeof createAdminClient>, restaurant: string, ids: string[]): Promise<ReturnAdjustment[]> {
  return everyRowIn<ReturnAdjustment>(ids, (slice, a, b) => db.from("order_adjustments")
    .select("id, order_id, currency, previous_total, resulting_total, previous_tip, resulting_tip, previous_service_fee, resulting_service_fee")
    .eq("restaurant_id", restaurant).eq("kind", "return").in("order_id", slice).order("id").range(a, b), "the sale's return components");
}

/** Reserved returns lower the live bill immediately. Add every saved reduction
 * back to sales readers so today's return cannot rewrite yesterday's dinner. */
export function returnComponents(adjustments: ReturnAdjustment[]): ReturnComponents {
  const result = { total: 0, tip: 0, service_fee: 0 };
  for (const a of adjustments) for (const key of ["total", "tip", "service_fee"] as const) {
    const before = a[`previous_${key}`], after = a[`resulting_${key}`];
    if (before == null || after == null || !Number.isFinite(Number(before)) || !Number.isFinite(Number(after))
      || cents(before) < cents(after) || cents(after) < 0) throw new Error("Could not verify the return components");
    result[key] = (cents(result[key]) + cents(before) - cents(after)) / 100;
  }
  return result;
}
/** A reduction racing the reads must give a retry, never an invented sale. */
export function verifyReturnedOrder(order: { total: number | string; tip?: number | string | null; service_fee?: number | string | null }, adjustments: ReturnAdjustment[]): void {
  const last = [...adjustments].sort((a, b) => Number(a.resulting_total) - Number(b.resulting_total))[0];
  if (last && (cents(last.resulting_total) !== cents(order.total) || cents(last.resulting_tip) !== cents(order.tip ?? 0)
    || cents(last.resulting_service_fee) !== cents(order.service_fee ?? 0))) throw new Error("The sale changed while reading its returns");
}
export async function withReturnComponents<T extends { id: string; currency?: string; total: number | string; tip?: number | string | null; service_fee?: number | string | null }>(
  db: ReturnType<typeof createAdminClient>, restaurant: string, orders: T[],
): Promise<(T & { return_components: ReturnComponents })[]> {
  const adjustments = await readReturnAdjustments(db, restaurant, orders.map(o => o.id));
  return orders.map(order => {
    const matching = adjustments.filter(a => a.order_id === order.id);
    if (matching.some(a => order.currency && a.currency !== order.currency)) throw new Error("The return currency differs from its sale");
    verifyReturnedOrder(order, matching);
    return { ...order, return_components: returnComponents(matching) };
  });
}
