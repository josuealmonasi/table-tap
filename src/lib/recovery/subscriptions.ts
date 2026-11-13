import { applySubscription } from "@/lib/subscription-sync";
import { combineResults, isolateJob, runBatch, type PendingItem, type RecoveryContext } from "./job";

interface SubscriptionRow extends PendingItem { id: string; stripe_subscription_id: string }

const UNPAID = ["locked", "past_due"];
const PAID = ["active", "trialing"];
/** How long after a period end the renewal or cancellation webhook may still arrive. */
export const PERIOD_GRACE_MS = 3 * 24 * 3600 * 1000;

/** Re-read the linked subscription and store it through the webhook's
 * revision-checked transition. A Stripe read that fails throws before any
 * write: recovery never downgrades a restaurant on a read error. */
async function refresh(context: RecoveryContext, row: SubscriptionRow): Promise<void> {
  const sub = await context.client.subscriptions.retrieve(row.stripe_subscription_id);
  if (sub.id !== row.stripe_subscription_id || sub.metadata?.restaurant_id !== row.id) {
    throw new Error("Subscription does not belong to this restaurant");
  }
  await applySubscription(sub, context.db, context.client, row.stripe_subscription_id);
}

export async function recoverSubscriptions(context: RecoveryContext) {
  const { db } = context;
  const columns = "id, restaurant_id:id, created_at, stripe_subscription_id";
  const unpaid = await isolateJob("unpaid subscriptions", () => runBatch("unpaid subscriptions", context, (limit, offset = 0) => db.from("restaurants")
    .select(columns, { count: "exact" }).in("plan_status", UNPAID).not("stripe_subscription_id", "is", null)
    .order("created_at").order("id").range(offset, offset + limit - 1).returns<SubscriptionRow[]>(), async row => {
    await refresh(context, row);
    const { data, error } = await db.from("restaurants").select("plan_status").eq("id", row.id).maybeSingle();
    if (error) throw new Error(error.message);
    return !data || !UNPAID.includes(data.plan_status);
  // There is no saved status-change date. Report the restaurant's age as an
  // upper bound, never pretend its signup date is when a payment failed.
  }, "restaurant_created_at_upper_bound"));
  // A paid tier whose period ended days ago with no renewal or cancellation
  // stored: every webhook delivery of that change may have failed, and the
  // tier would otherwise stay on forever with nothing charged (finding 3).
  const cutoff = new Date(Date.now() - PERIOD_GRACE_MS).toISOString();
  const lapsed = `plan_ends_at.lt.${cutoff},plan_period_ends_at.lt.${cutoff}`;
  const expired = await isolateJob("expired subscriptions", () => runBatch("expired subscriptions", context, (limit, offset = 0) => db.from("restaurants")
    .select(columns, { count: "exact" }).in("plan_status", PAID).neq("plan", "carta").not("stripe_subscription_id", "is", null)
    .or(lapsed).order("created_at").order("id").range(offset, offset + limit - 1).returns<SubscriptionRow[]>(), async row => {
    await refresh(context, row);
    const { data, error } = await db.from("restaurants").select("plan, plan_status, plan_ends_at, plan_period_ends_at")
      .eq("id", row.id).maybeSingle();
    if (error) throw new Error(error.message);
    const ended = (at: string | null) => at !== null && Date.parse(at) < Date.parse(cutoff);
    return !data || data.plan === "carta" || !PAID.includes(data.plan_status)
      || (!ended(data.plan_ends_at) && !ended(data.plan_period_ends_at));
  }, "restaurant_created_at_upper_bound"));
  // Restaurants synced before plan_period_ends_at existed have none stored:
  // read Stripe once (a page per run) and store it through the same
  // transition, so they are covered without waiting for their next webhook.
  const unknown = await isolateJob("subscription period backfill", () => runBatch("subscription period backfill", context, (limit, offset = 0) => db.from("restaurants")
    .select(columns, { count: "exact" }).in("plan_status", PAID).neq("plan", "carta").not("stripe_subscription_id", "is", null)
    .is("plan_period_ends_at", null).order("created_at").order("id").range(offset, offset + limit - 1).returns<SubscriptionRow[]>(), async row => {
    await refresh(context, row);
    const { data, error } = await db.from("restaurants").select("plan, plan_status, plan_period_ends_at").eq("id", row.id).maybeSingle();
    if (error) throw new Error(error.message);
    return !data || data.plan === "carta" || !PAID.includes(data.plan_status) || data.plan_period_ends_at !== null;
  }, "restaurant_created_at_upper_bound"));
  return combineResults([unpaid, expired, unknown], "restaurant_created_at_upper_bound");
}
