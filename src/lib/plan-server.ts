import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { can, type PlanFeature, type PlanLimits, type PlanStatus } from "@/lib/plan";

export interface RestaurantPlan {
  limits: PlanLimits;
  status: PlanStatus;
  trialEndsAt: string | null;
  /** Set once cancelled: the day the plan they paid for runs out. */
  planEndsAt: string | null;
}

/**
 * The tier a restaurant is on, with its ceilings.
 *
 * Read with the secret key on purpose: `plan_limits` is not granted to the
 * customer's role at all, and a restaurant must not be able to edit its own
 * ceiling by any route. Cached per request — a page guard and the handler
 * under it both ask, and they should not each pay for the round trip.
 */
export const getPlan = cache((restaurantId: string): Promise<RestaurantPlan | null> => readPlan(restaurantId));

async function readPlan(restaurantId: string, again = true): Promise<RestaurantPlan | null> {
  const { data, error } = await createAdminClient()
    .from("restaurants")
    .select("plan_status, trial_ends_at, plan_ends_at, stripe_subscription_id, subscription_sync_revision, plan_limits(*)")
    .eq("id", restaurantId)
    .maybeSingle<{
      plan_status: PlanStatus;
      trial_ends_at: string | null;
      plan_ends_at: string | null;
      stripe_subscription_id: string | null;
      subscription_sync_revision: number;
      plan_limits: PlanLimits | null;
    }>();

  // No such restaurant is an answer, and so is an id that is not one at all
  // (22P02): diners' routes pass what the URL says. Anything else is a read
  // that failed, and the plan guards turned its null into "forbidden" — a
  // restaurant on the right plan refused its own features in a database blip.
  if (error && error.code !== "22P02") throw new Error(`plan lookup failed: ${error.message}`);
  if (!data?.plan_limits) return null;

  // A trial that ran out is settled here rather than by a nightly job. The
  // database triggers read `restaurants.plan` directly, so a plan that expired
  // only in the app's head would still let a lapsed trial add tables — the row
  // itself has to change, and this is the moment someone asked.
  //
  // Only the app's own trial, never one Stripe is running for a subscription.
  if (data.plan_status === "trialing" && expired(data.trial_ends_at) && !data.stripe_subscription_id) {
    const ended = await endTrial(restaurantId, data.subscription_sync_revision);
    if (ended) return ended;
    // Something wrote the restaurant first — another request ending the same
    // trial, or a Stripe webhook linking the subscription the owner just
    // paid for. What it is on now is read, not assumed to be the free tier.
    if (again) return await readPlan(restaurantId, false);
  }

  return {
    limits: data.plan_limits,
    status: data.plan_status,
    trialEndsAt: data.trial_ends_at,
    planEndsAt: data.plan_ends_at,
  };
}

function expired(trialEndsAt: string | null): boolean {
  return Boolean(trialEndsAt) && new Date(trialEndsAt!).getTime() <= Date.now();
}

/**
 * Drops a finished trial to the free tier and reports what they now have, or
 * null when the restaurant changed since it was read.
 *
 * Nothing is deleted: a restaurant keeps every table and dish it built during
 * the trial, it simply cannot add more until it subscribes. Taking their work
 * away would be a strange way to ask for money.
 *
 * Written over the sync revision it was read at, like every plan write: the
 * owner whose subscription webhook lands between that read and this write
 * subscribed in time, and dropping them to the free tier would leave them
 * paying Stripe for a plan the restaurant no longer has.
 */
async function endTrial(restaurantId: string, revision: number): Promise<RestaurantPlan | null> {
  const db = createAdminClient();
  const { data: ended, error } = await db
    .from("restaurants")
    .update({ plan: "carta", plan_status: "active", trial_ends_at: null, subscription_sync_revision: revision + 1 })
    .eq("id", restaurantId)
    .eq("subscription_sync_revision", revision)
    .select("id");
  if (error) throw new Error(`ending a trial failed: ${error.message}`);
  if (!ended?.length) return null;

  const { data } = await db
    .from("plan_limits")
    .select("*")
    .eq("plan", "carta")
    .single<PlanLimits>();

  return data
    ? { limits: data, status: "active", trialEndsAt: null, planEndsAt: null }
    : null;
}

/** Every tier, cheapest first — for naming what an upgrade would unlock. */
/**
 * How many founding places have been taken.
 *
 * Read by the Plan screen and by checkout, so the price shown and the price
 * charged come from the same number.
 */
export const foundersTaken = cache(async (): Promise<number> => {
  const { count } = await createAdminClient()
    .from("restaurants")
    .select("id", { count: "exact", head: true })
    .not("founding_number", "is", null);
  return count ?? 0;
});

export const allPlans = cache(async (): Promise<PlanLimits[]> => {
  const { data } = await createAdminClient()
    .from("plan_limits")
    .select("*")
    .order("rank");
  return (data as PlanLimits[] | null) ?? [];
});

/** Whether the restaurant's tier carries `feature`. No plan row is "no". */
export async function tierIncludes(restaurantId: string, feature: PlanFeature): Promise<boolean> {
  const plan = await getPlan(restaurantId);
  return plan ? can(plan.limits, feature) : false;
}
