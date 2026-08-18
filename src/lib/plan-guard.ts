import type { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { can, cheapestWith, hasRoom, planLabel, type PlanFeature } from "@/lib/plan";
import { allPlans, getPlan } from "@/lib/plan-server";

/**
 * Whether the restaurant's tier allows this, as a refusal or nothing.
 *
 * Lives beside api-guard for the same reason that does: a route deciding for
 * itself what its plan allows is a route that gets it subtly wrong, and the
 * refusal has to name the tier that would unlock it — "coupons come with Casa"
 * is an answer, "upgrade to continue" is a shrug.
 */
export async function planBlocks(
  restaurantId: string,
  feature: PlanFeature,
): Promise<NextResponse | null> {
  const plan = await getPlan(restaurantId);
  if (!plan) return await apiError("apiErr.forbidden", 403);
  if (can(plan.limits, feature)) return null;

  const unlocks = cheapestWith(await allPlans(), feature);
  return await apiError(`plan.needs.${feature}`, 403, {
    plan: planLabel(unlocks?.plan ?? "casa"),
  });
}

/**
 * Whether one more staff login fits.
 *
 * The founding owner is not a seat — they are the account. `used` counts the
 * `staff` rows, which is exactly who was invited.
 */
export async function seatBlocks(
  restaurantId: string,
  used: number,
): Promise<NextResponse | null> {
  const plan = await getPlan(restaurantId);
  if (!plan) return await apiError("apiErr.forbidden", 403);
  if (hasRoom(used, plan.limits.max_staff)) return null;

  return await apiError("plan.limit.staff", 403, {
    plan: planLabel(plan.limits.plan),
    max: plan.limits.max_staff ?? 0,
  });
}
