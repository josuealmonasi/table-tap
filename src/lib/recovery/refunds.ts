import { runBatch, isolateJob, type RecoveryContext } from "./job";
import { reconcileSavedRefund, type SavedRefund } from "./refund-item";
import { notifyOverdueDue } from "./overdue";

export async function recoverRefunds(context: RecoveryContext) {
  const { db } = context;
  const columns = "id, restaurant_id, amount, created_at, stripe_refund_id, stripe_account_id, stripe_payment_intent";
  const orders = await isolateJob("order refunds", () => runBatch("order refunds", context, (limit, offset = 0) => db.from("refund_attempts")
    .select(`${columns}, operation_id, currency, refund_operations!inner(id, source, status, currency, stripe_account_id, stripe_payment_intent)`, { count: "exact" })
    .eq("origin", "app").eq("refund_operations.source", "stripe").in("refund_operations.status", ["pending", "processing"])
    .not("stripe_refund_id", "is", null).or("provider_status.is.null,provider_status.in.(pending,requires_action)")
    .order("created_at").order("id").range(offset, offset + limit - 1).returns<SavedRefund[]>(), row => reconcileSavedRefund(context, row)));
  const dues = await isolateJob("duplicate refunds", () => runBatch("duplicate refunds", context, (limit, offset = 0) => db.from("refund_due_attempts")
    .select(`${columns}, due_id, refunds_due!inner(currency, refunded_at, stripe_account_id, stripe_payment_intent, amount, table_label, account_name)`, { count: "exact" })
    .is("refunds_due.refunded_at", null).not("stripe_refund_id", "is", null)
    .or("provider_status.is.null,provider_status.in.(pending,requires_action)")
    .order("created_at").order("id").range(offset, offset + limit - 1).returns<SavedRefund[]>(), row => reconcileSavedRefund(context, row),
  "created_at", row => notifyOverdueDue(context, row)));
  const oldest = [orders, dues].filter(r => r.oldest_pending_at).sort((a, b) => a.oldest_pending_at!.localeCompare(b.oldest_pending_at!))[0];
  return { done: orders.done + dues.done, failed: orders.failed + dues.failed,
    pending: orders.pending === null || dues.pending === null ? null : orders.pending + dues.pending,
    oldest_pending_at: oldest?.oldest_pending_at ?? null, oldest_pending_age_seconds: oldest?.oldest_pending_age_seconds ?? null,
    age_basis: "created_at", ...(orders.observation_failed || dues.observation_failed ? { observation_failed: true } : {}) };
}
