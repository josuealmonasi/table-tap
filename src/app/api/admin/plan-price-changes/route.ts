import { NextRequest, NextResponse } from "next/server";
import { getPlatformAdmin } from "@/lib/admin";
import { auditedAdminAction } from "@/lib/admin-audit";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { priceChangeDate } from "@/lib/price-change-date";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function schedule(req: NextRequest): Promise<Response> {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ plan?: unknown; newPrice?: unknown; effectiveAt?: unknown }>(req);
  const effectiveAt = priceChangeDate(body?.effectiveAt);
  if (!body || typeof body.plan !== "string" || typeof body.newPrice !== "number"
    || !Number.isFinite(body.newPrice) || body.newPrice <= 0 || !effectiveAt) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const db = createAdminClient();
  const { data: plan, error } = await db.from("plan_limits").select("plan").eq("plan", body.plan).maybeSingle();
  if (error) return await apiError("apiErr.generic", 500);
  if (!plan) return await apiError("apiErr.invalidRequest", 400);
  const result = await db.rpc("schedule_plan_price_change", {
    p_plan: body.plan, p_price: body.newPrice, p_effective_at: effectiveAt, p_created_by: admin.userId,
  });
  if (result.error || !result.data) return await apiError("apiErr.generic", 500);
  return NextResponse.json({ id: result.data });
}

export const POST = auditedAdminAction("plan.price", schedule);
