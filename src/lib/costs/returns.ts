import type { createAdminClient } from "@/lib/supabase/admin";
import { everyRowIn } from "@/lib/paged";
import { readReturnEvents, type ReturnEvent } from "@/lib/refunds/events";
import { readReturnAdjustments } from "@/lib/return-components";
import { returnedFoodCents, type ReturnOperationComponents } from "@/lib/report-revenue";
import { withSavedCosts } from "./saved-costs";
import type { ContributionReturn, SoldOrder } from "./margins";

/** Read completed-sale returns by success date, including sales before the
 * window. Frozen valuations identify costed products; their costs and units
 * are never charged again. No pending promise or cancellation is deducted. */
export async function readContributionReturns(db: ReturnType<typeof createAdminClient>, restaurant: string,
  currency: string, since: string, end: string): Promise<ContributionReturn[]> {
  const current = await readReturnEvents(db, restaurant, since, end, { currency, kind: "return" });
  if (!current.length) return [];
  const ids = current.map(e => e.order_id);
  const [adjustments, orders] = await Promise.all([
    readReturnAdjustments(db, restaurant, ids),
    everyRowIn<SoldOrder & { id: string; currency: string }>(ids, (slice, a, b) => db.from("orders")
      .select("id, currency, items, total, service_fee, tip, tax_pct")
      .eq("restaurant_id", restaurant).eq("currency", currency).in("id", slice).order("id").range(a, b), "the returned sales"),
  ]);
  const operations = await everyRowIn<ReturnOperationComponents>(adjustments.map(a => a.id), (slice, a, b) => db.from("refund_operations")
    .select("id, adjustment_id, currency, amount, tip").eq("restaurant_id", restaurant)
    .in("adjustment_id", slice).order("id").range(a, b), "the returns' components");
  // Prior pieces fix the cumulative cent allocation. Only current pieces are
  // deducted below; a later completion cannot move an earlier period's cents.
  const events = await everyRowIn<ReturnEvent>(current.map(e => e.operation_id), (slice, a, b) => db.rpc("order_return_events_v1", {
    p_restaurant: restaurant, p_currency: currency,
  }).in("operation_id", slice).eq("kind", "return").lt("succeeded_at", end).order("id").range(a, b), "the return pieces");
  const food = new Map<string, number>();
  for (const adjustment of adjustments) {
    const ops = operations.filter(o => o.adjustment_id === adjustment.id);
    if (adjustment.currency !== currency || ops.some(o => o.currency !== currency)
      || events.some(e => ops.some(o => o.id === e.operation_id) && e.order_id !== adjustment.order_id)) {
      throw new Error("The returned food scope differs from its sale");
    }
    for (const [id, amount] of returnedFoodCents(adjustment, ops, events)) food.set(id, amount);
  }
  const saved = await withSavedCosts(db, restaurant, orders);
  return current.map(event => {
    const order = saved.find(o => o.id === event.order_id);
    const amount = food.get(event.id);
    if (!order || amount === undefined) throw new Error("Could not verify the returned sale");
    return { order, food: amount / 100 };
  });
}
