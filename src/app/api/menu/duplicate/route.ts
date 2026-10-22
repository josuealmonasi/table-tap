import { NextRequest, NextResponse } from "next/server";
import { actingManager } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { frozenBlocks, planBlocks } from "@/lib/plan-guard";
import { planLabel } from "@/lib/plan";
import { parsePlanLimit, planLimitText } from "@/lib/plan-error";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ sourceId?: string }>(req);
  if (!body || typeof body.sourceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.sourceId)) {
    return apiError("apiErr.invalidRequest", 400);
  }
  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;
  const { data, error } = await createAdminClient().rpc("duplicate_menu_v1", {
    p_restaurant: actor.restaurantId, p_source: body.sourceId,
  });
  if (error?.message.includes("tt_plan_frozen")) return apiError("plan.frozen", 402);
  if (error?.message.includes("tt_plan_feature")) {
    return (await planBlocks(actor.restaurantId, "menuSchedules")) ?? apiError("write.duplicateMenu", 409);
  }
  const limit = parsePlanLimit(error?.message);
  if (limit) {
    const { key, vars } = planLimitText(limit);
    return apiError(key, 403, { ...vars, plan: planLabel(vars.plan) });
  }
  if (error) return apiError("write.duplicateMenu", 500);
  if (!data) return apiError("apiErr.notFound", 404);
  return NextResponse.json(data);
}
