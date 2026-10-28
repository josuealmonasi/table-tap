import type { createAdminClient } from "@/lib/supabase/admin";
import { everyRowIn } from "@/lib/paged";
import type { ReceiptOrder } from "@/lib/receipt";
import type { ReceiptReturn } from "@/lib/receipt-returns";
import { returnComponents, type ReturnAdjustment } from "@/lib/return-components";
import { receiptCents as cents } from "@/lib/receipt-amount";

/** Restore only the chosen sale version, then apply its reserved returns.
 * Forgiveness remains a loss, never money that a return can give back. */
export async function readReceiptReturns(db: ReturnType<typeof createAdminClient>, restaurant: string,
  orders: ReceiptOrder[], adjustments: ReturnAdjustment[]): Promise<ReceiptOrder[]> {
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
