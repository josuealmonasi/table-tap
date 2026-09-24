import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { normalizeCode } from "@/lib/loyalty/code";
import { redeem } from "@/lib/loyalty/server";

export const runtime = "nodejs";

// POST /api/loyalty/redeem  { code, step } — spend a card's next reward, once.
//
// The floor, like stamping: the reward was earned under rules the owner set,
// so honouring it is serving the diner, not a discount somebody decides on.
// Not gated on the program being on or the plan including loyalty: a reward
// already earned is honoured after either changes — the diner did their part.
// The database refuses a reward that is not ready, or not the one pressed,
// under a lock, so two waiters tapping at once spend it once.
export async function POST(req: NextRequest) {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<{ code?: unknown; step?: unknown }>(req);
  const code = typeof body?.code === "string" ? normalizeCode(body.code) : null;
  if (!code) return await apiError("rewards.invalid", 400);
  // The reward the waiter pressed, by its visits. Optional, for a screen from
  // before the ladder; anything else sent is refused rather than ignored.
  const step = body?.step;
  if (step !== undefined && step !== null && (typeof step !== "number" || !Number.isInteger(step))) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const result = await redeem(actor.restaurantId, code, actor.email, typeof step === "number" ? step : null);
  if ("error" in result) {
    if (result.error === "notHere") return await apiError("apiErr.loyaltyNotHere", 404);
    if (result.error === "notReady") return await apiError("apiErr.loyaltyNotReady", 409);
    if (result.error === "alreadyRedeemed") return await apiError("apiErr.loyaltyAlreadyRedeemed", 409);
    return await apiError("apiErr.generic", 500);
  }

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "loyalty",
    action: "redeemed",
    detail: logDetail({ card: code.slice(0, 4), reward: result.spent }),
  });
  return NextResponse.json(result);
}
