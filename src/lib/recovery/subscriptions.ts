import { applySubscription } from "@/lib/subscription-sync";
import { runBatch, type PendingItem, type RecoveryContext } from "./job";

interface SubscriptionRow extends PendingItem { id: string; stripe_subscription_id: string }

export async function recoverSubscriptions(context: RecoveryContext) {
  const { db, client } = context;
  return runBatch("subscriptions", context, (limit, offset = 0) => db.from("restaurants")
    .select("id, restaurant_id:id, created_at, stripe_subscription_id", { count: "exact" })
    .in("plan_status", ["locked", "past_due"]).not("stripe_subscription_id", "is", null)
    .order("created_at").order("id").range(offset, offset + limit - 1).returns<SubscriptionRow[]>(), async row => {
    const sub = await client.subscriptions.retrieve(row.stripe_subscription_id);
    if (sub.id !== row.stripe_subscription_id || sub.metadata?.restaurant_id !== row.id) {
      throw new Error("Subscription does not belong to this restaurant");
    }
    await applySubscription(sub, db, client, row.stripe_subscription_id);
    const { data, error } = await db.from("restaurants").select("plan_status")
      .eq("id", row.id).maybeSingle();
    if (error) throw new Error(error.message);
    return !data || !["locked", "past_due"].includes(data.plan_status);
  // There is no saved status-change date. Report the restaurant's age as an
  // upper bound, never pretend its signup date is when a payment failed.
  }, "restaurant_created_at_upper_bound");
}
