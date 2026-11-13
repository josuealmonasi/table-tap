import { reconcileDispute } from "@/lib/disputes/reconcile";
import { runBatch, type PendingItem, type RecoveryContext } from "./job";

interface QueuedDispute extends PendingItem { id: string }

export async function recoverDisputes(context: RecoveryContext) {
  return runBatch("disputes", context, (limit, offset = 0) => context.db.from("stripe_dispute_events")
    .select("id, restaurant_id, created_at", { count: "exact" }).neq("state", "done")
    .order("created_at").order("id").range(offset, offset + limit - 1).returns<QueuedDispute[]>(),
  row => reconcileDispute(context.db, context.client, row.id));
}
