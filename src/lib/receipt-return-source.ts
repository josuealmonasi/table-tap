import type { createAdminClient } from "@/lib/supabase/admin";
import { everyRowIn } from "@/lib/paged";
import type { ReceiptReturn } from "@/lib/receipt-returns";
import { returnComponents, type ReturnAdjustment } from "@/lib/return-components";
import { receiptCents as cents } from "@/lib/receipt-amount";

interface ReturnOrder {
  id: string; currency: string; total: number | string;
  tip?: number | string | null; service_fee?: number | string | null;
}
/** Restore only the chosen sale version, then apply its reserved returns.
 * Forgiveness remains a loss, never money that a return can give back. */
export async function readReceiptReturns<T extends ReturnOrder>(db: ReturnType<typeof createAdminClient>, restaurant: string,
  orders: T[], adjustments: ReturnAdjustment[]): Promise<(T & { return_components?: ReturnType<typeof returnComponents>; returns?: ReceiptReturn[] })[]> {
  const found = await everyRowIn<ReceiptReturn & { adjustment_id: string; currency: string }>(adjustments.map(a => a.id),
    (ids, a, b) => db.from("refund_operations")
      .select("id, adjustment_id, source, amount, tip, currency, status, completed_at")
      .eq("restaurant_id", restaurant).in("adjustment_id", ids).order("id").range(a, b), "the receipt's returns");
  const operations = await Promise.all(found.map(async operation => {
    if (operation.source !== "stripe" || operation.status === "succeeded") return operation;
    const { data, error } = await db.rpc("refund_operation_progress_v1", { p_operation: operation.id });
    if (error || !data || !Number.isSafeInteger(data.outstanding_cents) || data.outstanding_cents < 0
      || data.outstanding_cents > cents(operation.amount)) throw new Error("Could not verify the partial return");
    return { ...operation, returned_cents: cents(operation.amount) - data.outstanding_cents };
  }));
  return orders.map(order => {
    const matching = adjustments.filter(a => a.order_id === order.id);
    if (!matching.length) return order;
    const components = returnComponents(matching);
    const returns = operations.filter(o => matching.some(a => a.id === o.adjustment_id));
    if (returns.some(r => r.currency !== order.currency) || returns.reduce((sum, r) => sum + cents(r.amount), 0) !== cents(components.total)) {
      throw new Error("Could not verify the receipt's return plan");
    }
    return { ...order, total: (cents(order.total) - cents(components.total)) / 100,
      tip: (cents(order.tip ?? 0) - cents(components.tip)) / 100,
      service_fee: (cents(order.service_fee ?? 0) - cents(components.service_fee)) / 100,
      return_components: components, returns };
  });
}

interface CancelledOrder extends ReturnOrder { paid?: boolean }
/**
 * A paid order's cancellation, read as the return of everything left on it.
 * A fresh receipt read only returns and forgiveness, so an order cancelled and
 * refunded in full still printed "Total MX$100.00" with no word of the refund
 * (sweep 4, finding 1). Its refund operations then prove the amount, exactly as
 * a return's do. An unpaid order had nothing to give back and is left as it was.
 */
export async function readCancelReturns(db: ReturnType<typeof createAdminClient>, restaurant: string,
  orders: CancelledOrder[]): Promise<ReturnAdjustment[]> {
  const paid = orders.filter(o => o.paid);
  const found = await everyRowIn<{ id: string; order_id: string; currency: string | null; previous_total: number; previous_tip: number | null }>(
    paid.map(o => o.id), (ids, a, b) => db.from("order_adjustments")
      .select("id, order_id, currency, previous_total, previous_tip")
      .eq("restaurant_id", restaurant).eq("kind", "cancel").in("order_id", ids).order("id").range(a, b), "the sale's cancellation");
  return found.map(c => {
    const order = paid.find(o => o.id === c.order_id)!;
    return { id: c.id, order_id: c.order_id, currency: c.currency ?? order.currency,
      previous_total: c.previous_total, resulting_total: 0,
      previous_tip: c.previous_tip ?? Number(order.tip ?? 0), resulting_tip: 0,
      previous_service_fee: Number(order.service_fee ?? 0), resulting_service_fee: 0 };
  });
}
