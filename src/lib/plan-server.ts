import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanLimits, PlanStatus } from "@/lib/plan";

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
export const getPlan = cache(async (restaurantId: string): Promise<RestaurantPlan | null> => {
  const { data } = await createAdminClient()
    .from("restaurants")
    .select("plan_status, trial_ends_at, plan_ends_at, plan_limits(*)")
    .eq("id", restaurantId)
    .single<{
      plan_status: PlanStatus;
      trial_ends_at: string | null;
      plan_ends_at: string | null;
      plan_limits: PlanLimits | null;
    }>();

  if (!data?.plan_limits) return null;

  // A trial that ran out is settled here rather than by a nightly job. The
  // database triggers read `restaurants.plan` directly, so a plan that expired
  // only in the app's head would still let a lapsed trial add tables — the row
  // itself has to change, and this is the moment someone asked.
  if (data.plan_status === "trialing" && expired(data.trial_ends_at)) {
    return await endTrial(restaurantId);
  }

  return {
    limits: data.plan_limits,
    status: data.plan_status,
    trialEndsAt: data.trial_ends_at,
    planEndsAt: data.plan_ends_at,
  };
});

function expired(trialEndsAt: string | null): boolean {
  return Boolean(trialEndsAt) && new Date(trialEndsAt!).getTime() <= Date.now();
}

/**
 * Drops a finished trial to the free tier and reports what they now have.
 *
 * Nothing is deleted: a restaurant keeps every table and dish it built during
 * the trial, it simply cannot add more until it subscribes. Taking their work
 * away would be a strange way to ask for money.
 */
async function endTrial(restaurantId: string): Promise<RestaurantPlan | null> {
  const db = createAdminClient();
  await db
    .from("restaurants")
    .update({ plan: "carta", plan_status: "active", trial_ends_at: null })
    .eq("id", restaurantId)
    .eq("plan_status", "trialing"); // no-op if another request got here first

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
 * Cuántos lugares de fundador se han tomado.
 *
 * Lo leen la pantalla de Plan y el checkout, para que el precio que se muestra
 * y el que se cobra salgan del mismo número.
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
