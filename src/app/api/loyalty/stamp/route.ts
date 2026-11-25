import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { getPlan } from "@/lib/plan-server";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { uuidOf } from "@/lib/costs/guard";
import { MANAGES } from "@/lib/membership";
import { orderCode } from "@/lib/types";
import { normalizeCode } from "@/lib/loyalty/code";
import { loyaltyOn, stamp, type StampRefusal } from "@/lib/loyalty/server";

export const runtime = "nodejs";

const REFUSALS: Record<StampRefusal, string> = {
  saleNotPaid: "apiErr.stampSaleNotPaid",
  saleNotToday: "apiErr.stampSaleNotToday",
  saleUsed: "apiErr.stampSaleUsed",
};

// POST /api/loyalty/stamp  { code, saleId? } — record today's visit on a diner's card.
//
// The floor only: owner, manager, waiter, cashier. Not the kitchen — a shared
// screen on the pass is the last place a free visit should be one tap away.
// A visit stands on a sale (review 2026-11-25): a waiter or a cashier names
// the paid sale behind it, and the database checks it is this restaurant's,
// paid today and behind no other card's stamp. A manager or the owner may
// stamp without one; that override is recorded in the activity log as such.
export async function POST(req: NextRequest) {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<{ code?: unknown; saleId?: unknown }>(req);
  const code = typeof body?.code === "string" ? normalizeCode(body.code) : null;
  if (!code) return await apiError("rewards.invalid", 400);
  const saleId = body?.saleId == null ? null : uuidOf(body.saleId);
  if (body?.saleId != null && !saleId) return await apiError("apiErr.stampSaleNotPaid", 400);
  const override = saleId === null;
  if (override && !MANAGES(actor.role)) return await apiError("apiErr.stampNeedsSale", 403);

  const plan = await getPlan(actor.restaurantId);
  if (!(await loyaltyOn(actor.restaurantId, plan?.limits ?? null))) {
    return await apiError("apiErr.loyaltyOff", 409);
  }

  const result = await stamp(actor.restaurantId, code, actor.email, saleId);
  if ("refused" in result) return await apiError(REFUSALS[result.refused], 409);
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
      detail: logDetail({
        card: code.slice(0, 4),
        visits: result.standing.visits,
        goal: result.standing.goal,
        order: saleId ? orderCode(saleId) : null,
        override: override ? "no_sale" : null,
      }),
    });
  }
  return NextResponse.json(result);
}
