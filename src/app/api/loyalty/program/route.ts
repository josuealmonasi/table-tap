import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingManager } from "@/lib/api-guard";
import { getPlan } from "@/lib/plan-server";
import { can } from "@/lib/plan";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { checkProgram } from "@/lib/loyalty/ladder";

export const runtime = "nodejs";

// POST /api/loyalty/program  { active, steps: [{ visits, reward }] } — the
// restaurant's visit card: whether it runs and its reward ladder, one to four
// rewards each earned at a number of visits. Owner or manager, on a plan that
// includes it. `{ active, goal, reward }` is still read as a ladder of one, so
// a Lealtad page left open across a deploy saves what its owner meant.
//
// Changing the ladder never moves the finish line on a card already on its
// way: each card keeps the ladder it was given and takes the new one after its
// round ends. That lives in the database; this only writes the program.
export async function POST(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const plan = await getPlan(actor.restaurantId);
  if (!plan || !can(plan.limits, "loyalty")) return await apiError("apiErr.loyaltyPlan", 403);

  const body = await jsonBody<{ active?: unknown; steps?: unknown; goal?: unknown; reward?: unknown }>(req);
  const active = body?.active;
  if (typeof active !== "boolean") return await apiError("apiErr.invalidRequest", 400);
  const raw = body && "steps" in body ? body.steps : [{ visits: body?.goal, reward: body?.reward }];
  // A program switched on with nothing to earn would hand out cards that
  // promise nothing; `checkProgram` refuses it, and every other broken ladder.
  const checked = checkProgram(active, raw);
  if ("error" in checked) return await apiError(checked.error, 400, checked.vars);
  const { steps, goal, reward } = checked;

  const { error } = await createAdminClient()
    .from("loyalty_programs")
    .upsert(
      { restaurant_id: actor.restaurantId, active, goal, reward, steps, updated_at: new Date().toISOString() },
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
    detail: logDetail({ goal, reward, steps: steps.length }),
  });
  return NextResponse.json({ ok: true });
}
