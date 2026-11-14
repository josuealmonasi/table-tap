import { reconcileDispute } from "@/lib/disputes/reconcile";
import { runBatch, type PendingItem, type RecoveryContext } from "./job";

interface QueuedDispute extends PendingItem { id: string }

export async function recoverDisputes(context: RecoveryContext) {
  return runBatch("disputes", context, (limit, offset = 0) => context.db.from("stripe_dispute_events")
    // An event set aside for review after repeated failures is platform work,
    // not polled again; a new webhook delivery may still claim and finish it.
    .select("id, restaurant_id, created_at", { count: "exact" }).in("state", ["pending", "processing", "error"])
    .order("created_at").order("id").range(offset, offset + limit - 1).returns<QueuedDispute[]>(),
  row => reconcileDispute(context.db, context.client, row.id));
}
