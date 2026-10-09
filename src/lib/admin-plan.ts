import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";

type Db = ReturnType<typeof createAdminClient>;

export type PlanMoveAnswer =
  | { ok: true; from: string; to: string }
  | { ok: false; error: string; status: number };

/** Subscription states in which Stripe will go on billing, and so go on setting the plan. */
const LIVE = new Set(["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]);

/**
 * A platform admin moves a restaurant to another plan — and with it everyone
 * who works there, because a plan belongs to the restaurant, not to a login.
 *
 * It is an assignment, not a sale: nothing is charged or refunded, so the
 * restaurant comes out `active` on the new plan with any trial or end date
 * cleared. Which is also why it refuses a restaurant still paying through a
 * live Stripe subscription: the next billing event writes the plan Stripe is
 * charging for back over this one, and in between the owner would be billed
 * for a plan they no longer have. That one changes in Stripe.
 *
 * Written down in the restaurant's own activity log, so the owner can see who
 * changed what their team can use.
 */
export async function moveRestaurantPlan(
  db: Db,
  restaurantId: string,
  plan: string,
  adminEmail: string,
  client: Stripe = stripe,
): Promise<PlanMoveAnswer> {
  const { data: tier } = await db.from("plan_limits").select("plan").eq("plan", plan).maybeSingle();
  if (!tier) return { ok: false, error: "apiErr.planUnknown", status: 400 };

  const { data: restaurant } = await db
    .from("restaurants")
    .select("id, plan, stripe_subscription_id, subscription_sync_revision")
    .eq("id", restaurantId)
    .maybeSingle();
  if (!restaurant) return { ok: false, error: "apiErr.restaurantNotFound", status: 404 };

  const subscription = restaurant.stripe_subscription_id as string | null;
  if (subscription) {
    const status = await client.subscriptions
      .retrieve(subscription)
      .then(s => s.status as string)
      .catch(err => (err?.code === "resource_missing" ? "gone" : "unknown"));
    // Unknown is refused too: guessing "not billing" is how an owner pays twice.
    if (status === "unknown" || LIVE.has(status)) {
      return { ok: false, error: "apiErr.planHasSubscription", status: 409 };
    }
  }

  const from = restaurant.plan as string;
  const revision = Number(restaurant.subscription_sync_revision ?? 0);
  // The finished subscription is unlinked and the sync revision moves on, so a
  // Stripe event still in flight for it neither matches nor writes over this
  // (`applySubscription` ignores a finished one the restaurant no longer has).
  //
  // And only over the revision read above, the way the Stripe sync writes: an
  // owner who subscribed between that read and this write has a live
  // subscription this would unlink, and would pay Stripe for a plan the
  // restaurant no longer has until the next billing event put it back.
  const { data: moved, error } = await db
    .from("restaurants")
    .update({
      plan,
      plan_status: "active",
      trial_ends_at: null,
      plan_ends_at: null,
      stripe_subscription_id: null,
      subscription_sync_revision: revision + 1,
    })
    .eq("id", restaurantId)
    .eq("subscription_sync_revision", revision)
    .select("id");
  if (error) {
    console.error("admin plan move failed:", error.message);
    return { ok: false, error: "apiErr.generic", status: 500 };
  }
  if (!moved?.length) return { ok: false, error: "apiErr.planChangedMeanwhile", status: 409 };

  await logEvent({
    restaurantId,
    actor: adminEmail,
    entity: "settings",
    action: "updated",
    detail: logDetail({ plan: `${from}→${plan}`, by: "platform_admin" }),
  });
  return { ok: true, from, to: plan };
}
