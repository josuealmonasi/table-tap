import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { normalizeCode } from "@/lib/loyalty/code";
import { redeem } from "@/lib/loyalty/redeem";

export const runtime = "nodejs";

// POST /api/loyalty/redeem  { code, step, round, requestKey } — spend a card's next reward, once.
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

  const body = await jsonBody<{ code?: unknown; step?: unknown; round?: unknown; requestKey?: unknown }>(req);
  const code = typeof body?.code === "string" ? normalizeCode(body.code) : null;
  if (!code) return await apiError("rewards.invalid", 400);
  // The reward and round the waiter pressed. Guessing either could spend a
  // reward on a card the screen has not shown yet.
  const step = body?.step;
  const round = body?.round;
  const requestKey = body?.requestKey;
  if (typeof step !== "number" || !Number.isInteger(step) || step < 2 || step > 50 ||
      typeof round !== "number" || !Number.isInteger(round) || round < 0 || round > 2147483647 ||
      typeof requestKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey)) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const result = await redeem(actor.restaurantId, code, actor.email, step, round, requestKey);
  if ("error" in result) {
    if (result.error === "roundChanged") return await apiError("apiErr.loyaltyRoundChanged", 409);
    if (result.error === "invalidRequest") return await apiError("apiErr.invalidRequest", 400);
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
