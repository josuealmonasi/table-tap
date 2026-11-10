import { recoverQueuedFee } from "@/lib/refunds/fee-queue";
import { runBatch, type PendingItem, type RecoveryContext } from "./job";

interface QueuedFee extends PendingItem { stripe_payment_intent: string }

export async function recoverFees(context: RecoveryContext) {
  const { db, client } = context;
  return runBatch("fees", context, (limit, offset = 0) => db.from("fee_reconcile_queue")
    .select("restaurant_id, created_at:enqueued_at, stripe_payment_intent", { count: "exact" })
    .order("enqueued_at").order("restaurant_id").order("stripe_payment_intent").range(offset, offset + limit - 1).returns<QueuedFee[]>(),
  row => recoverQueuedFee(db, client, row.restaurant_id, row.stripe_payment_intent), "enqueued_at");
}
