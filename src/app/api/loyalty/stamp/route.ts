import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { getPlan } from "@/lib/plan-server";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { normalizeCode } from "@/lib/loyalty/code";
import { loyaltyOn, stamp } from "@/lib/loyalty/server";

export const runtime = "nodejs";

// POST /api/loyalty/stamp  { code } — record today's visit on a diner's card.
//
// The floor only: owner, manager, waiter, cashier. Not the kitchen — a shared
// screen on the pass is the last place a free visit should be one tap away.
// Every stamp names who made it, in the activity log as well as on the visit,
// because a stamp without a sale behind it is the way this could be abused.
export async function POST(req: NextRequest) {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<{ code?: unknown }>(req);
  const code = typeof body?.code === "string" ? normalizeCode(body.code) : null;
  if (!code) return await apiError("rewards.invalid", 400);

  const plan = await getPlan(actor.restaurantId);
  if (!(await loyaltyOn(actor.restaurantId, plan?.limits ?? null))) {
    return await apiError("apiErr.loyaltyOff", 409);
  }

  const result = await stamp(actor.restaurantId, code, actor.email);
  if ("error" in result) {
    return result.error === "notHere"
      ? await apiError("apiErr.loyaltyNotHere", 404)
      : await apiError("apiErr.generic", 500);
  }

  if (result.stamped) {
    await logEvent({
      restaurantId: actor.restaurantId,
      actor: actor.email,
      entity: "loyalty",
      action: "stamped",
      detail: logDetail({ card: code.slice(0, 4), visits: result.standing.visits, goal: result.standing.goal }),
    });
  }
  return NextResponse.json(result);
}
