import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingManager } from "@/lib/api-guard";
import { getPlan } from "@/lib/plan-server";
import { can } from "@/lib/plan";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { GOAL_MAX, GOAL_MIN, REWARD_MAX } from "@/lib/loyalty/rules";

export const runtime = "nodejs";

// POST /api/loyalty/program  { active, goal, reward } — the restaurant's visit
// card: whether it runs, how many visits earn the reward, and what the reward
// is. Owner or manager, on a plan that includes it.
//
// Changing the goal never moves the finish line on a card already on its way:
// each card keeps the goal it was given and takes the new one after its next
// reward. That lives in the database; this only writes the program.
export async function POST(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const plan = await getPlan(actor.restaurantId);
  if (!plan || !can(plan.limits, "loyalty")) return await apiError("apiErr.loyaltyPlan", 403);

  const body = await jsonBody<{ active?: unknown; goal?: unknown; reward?: unknown }>(req);
  const active = body?.active;
  const goal = body?.goal;
  const reward = typeof body?.reward === "string" ? body.reward.trim() : null;
  if (typeof active !== "boolean") return await apiError("apiErr.invalidRequest", 400);
  if (typeof goal !== "number" || !Number.isInteger(goal) || goal < GOAL_MIN || goal > GOAL_MAX) {
    return await apiError("apiErr.loyaltyGoal", 400, { min: GOAL_MIN, max: GOAL_MAX });
  }
  if (reward === null || reward.length > REWARD_MAX) {
    return await apiError("apiErr.loyaltyReward", 400, { max: REWARD_MAX });
  }
  // A program switched on with nothing to earn would hand out cards that
  // promise nothing.
  if (active && reward.length === 0) return await apiError("apiErr.loyaltyRewardNeeded", 400);

  const { error } = await createAdminClient()
    .from("loyalty_programs")
    .upsert(
      { restaurant_id: actor.restaurantId, active, goal, reward, updated_at: new Date().toISOString() },
      { onConflict: "restaurant_id" },
    );
  if (error) {
    console.error("loyalty program save failed:", error.message);
    return await apiError("apiErr.generic", 500);
  }

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "loyalty",
    action: active ? "updated" : "paused",
    detail: logDetail({ goal, reward }),
  });
  return NextResponse.json({ ok: true });
}
