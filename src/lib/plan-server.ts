import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanLimits, PlanStatus } from "@/lib/plan";

export interface RestaurantPlan {
  limits: PlanLimits;
  status: PlanStatus;
  trialEndsAt: string | null;
}

/**
 * The tier a restaurant is on, with its ceilings.
 *
 * Read with the secret key on purpose: `plan_limits` is not granted to the
 * customer's role at all, and a restaurant must not be able to edit its own
 * ceiling by any route. Cached per request — a page guard and the handler
 * under it both ask, and they should not each pay for the round trip.
 */
export const getPlan = cache(async (restaurantId: string): Promise<RestaurantPlan | null> => {
  const { data } = await createAdminClient()
    .from("restaurants")
    .select("plan_status, trial_ends_at, plan_limits(*)")
    .eq("id", restaurantId)
    .single<{
      plan_status: PlanStatus;
      trial_ends_at: string | null;
      plan_limits: PlanLimits | null;
    }>();

  if (!data?.plan_limits) return null;
  return {
    limits: data.plan_limits,
    status: data.plan_status,
    trialEndsAt: data.trial_ends_at,
  };
});

/** Every tier, cheapest first — for naming what an upgrade would unlock. */
export const allPlans = cache(async (): Promise<PlanLimits[]> => {
  const { data } = await createAdminClient()
    .from("plan_limits")
    .select("*")
    .order("rank");
  return (data as PlanLimits[] | null) ?? [];
});
