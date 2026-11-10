import { refundEvidence, verifiedRefund, type ReturnCharge } from "@/lib/refunds/return-provider";
import { verifyDueCurrency } from "@/lib/refunds/due-recovery";
import type { PendingItem, RecoveryContext } from "./job";

export interface SavedRefund extends PendingItem {
  id: string;
  operation_id?: string;
  due_id?: string;
  amount: number;
  currency: string | null;
  stripe_refund_id: string;
  stripe_account_id: string;
  stripe_payment_intent: string;
  refund_operations?: ReturnCharge;
  refunds_due?: { currency: string | null; stripe_account_id: string | null; stripe_payment_intent: string;
    amount: number; table_label: string | null; account_name: string | null };
}

/** Only saved provider IDs enter here. Recovery has no door to a new refund. */
export async function reconcileSavedRefund(context: RecoveryContext, row: SavedRefund): Promise<boolean> {
  const { db, client } = context;
  const owner = row.refund_operations ?? row.refunds_due;
  if (!owner || owner.stripe_payment_intent !== row.stripe_payment_intent
    || owner.stripe_account_id && owner.stripe_account_id !== row.stripe_account_id) {
    throw new Error("Refund attempt does not match its original charge");
  }
  let currency = owner.currency;
  if (!currency && row.due_id) currency = await verifyDueCurrency(db, row.restaurant_id, row.due_id, row, client);
  if (!currency || row.currency && row.currency !== currency) throw new Error("Refund currency cannot be verified");
  const operation: ReturnCharge = { id: row.operation_id ?? row.due_id!, source: "stripe", status: "processing",
    currency, stripe_account_id: row.stripe_account_id, stripe_payment_intent: row.stripe_payment_intent };
  const refund = await client.refunds.retrieve(row.stripe_refund_id, { stripeAccount: row.stripe_account_id });
  if (refund.id !== row.stripe_refund_id || !verifiedRefund(refund, operation)
    || refund.amount !== Math.round(Number(row.amount) * 100)) throw new Error("Refund provider evidence does not match its saved request");
  const args = { p_restaurant: row.restaurant_id, p_actor: "scheduled recovery", p_attempt: row.id,
    p_status: refund.status, p_refunds: [refundEvidence(refund, operation)] };
  const { data, error } = row.operation_id
    ? await db.rpc("finish_refund_operation_v2", { ...args, p_operation: row.operation_id })
    : await db.rpc("finish_refund_due_attempt_v2", { ...args, p_due: row.due_id });
  if (error) throw new Error(error.message);
  if (["failed", "canceled"].includes(refund.status!)) throw new Error("Stripe reports that this refund failed");
  if (!["completed", "partial"].includes(data?.outcome) || refund.status !== "succeeded") return false;
  // Customer completion stays recorded if enqueue fails. The existing fee
  // completion readers and webhook can still discover the unpaid fee.
  const queued = await db.rpc("enqueue_fee_reconcile", { p_restaurant: row.restaurant_id, p_intent: row.stripe_payment_intent });
  if (queued.error) throw new Error(queued.error.message);
  return true;
}
