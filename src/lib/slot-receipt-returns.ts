import type { createAdminClient } from "@/lib/supabase/admin";
import { everyRow, everyRowIn } from "@/lib/paged";
import type { SlotReceiptPayment } from "@/lib/receipt";
import type { ReceiptReturn } from "@/lib/receipt-returns";
import { receiptCents as cents } from "@/lib/receipt-amount";

/** Follow the receipt's allocations, never substitute its whole table's sale. */
export async function slotReceiptReturns(db: ReturnType<typeof createAdminClient>, restaurant: string, payment: SlotReceiptPayment): Promise<SlotReceiptPayment> {
  const allocations = await everyRow<{ id: string }>((a, b) => db.from("payment_allocations").select("id")
    .eq("restaurant_id", restaurant).eq("payment_id", payment.id).order("id").range(a, b), "the paid parts' allocations");
  const links = await everyRowIn<{ operation_id: string; amount: number; tip: number }>(allocations.map(a => a.id), (ids, a, b) =>
    db.from("refund_allocations").select("operation_id, amount, tip").eq("restaurant_id", restaurant)
      .in("allocation_id", ids).order("id").range(a, b), "the paid parts' returns");
  const operations = await everyRowIn<ReceiptReturn & { currency: string }>(links.map(l => l.operation_id), (ids, a, b) =>
    db.from("refund_operations").select("id, source, amount, tip, currency, status, completed_at").eq("restaurant_id", restaurant)
      .in("id", ids).order("id").range(a, b), "the paid parts' return outcomes");
  if (new Set(links.map(l => l.operation_id)).size !== operations.length || operations.some(o => o.currency !== payment.currency)) {
    throw new Error("Could not verify the paid parts' returns");
  }
  if (!operations.length) return payment;
  const returns = await Promise.all(operations.map(async operation => {
    const matching = links.filter(l => l.operation_id === operation.id);
    const amount = matching.reduce((sum, link) => sum + cents(link.amount), 0);
    const tip = matching.reduce((sum, link) => sum + cents(link.tip), 0);
    let given = operation.status === "succeeded" ? amount : 0;
    if (operation.source === "stripe" && operation.status !== "succeeded") {
      const { data, error } = await db.rpc("refund_operation_progress_v1", { p_operation: operation.id });
      // An ambiguous partial pooled across receipts needs review, not a guessed share.
      if (error || !data || !Number.isSafeInteger(data.outstanding_cents) || data.outstanding_cents < 0
        || amount !== cents(operation.amount) || data.outstanding_cents > amount) throw new Error("Could not verify the paid parts' partial return");
      given = amount - data.outstanding_cents;
    }
    return { ...operation, amount: amount / 100, tip: tip / 100, returned_cents: given };
  }));
  const total = returns.reduce((sum, r) => sum + cents(r.amount), 0);
  const tip = returns.reduce((sum, r) => sum + cents(r.tip), 0);
  if (total > cents(payment.amount) || tip > cents(payment.tip)) throw new Error("The paid parts' return exceeds their receipt");
  return { ...payment, return_components: { total: total / 100, tip: tip / 100, service_fee: 0 }, returns };
}
