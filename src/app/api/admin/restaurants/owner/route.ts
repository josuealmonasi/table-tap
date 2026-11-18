import { NextRequest, NextResponse } from "next/server";
import { auditedAdminAction } from "@/lib/admin-audit";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { getPlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";

export const runtime = "nodejs";

const ANSWERS: Record<string, [string, number]> = {
  not_found: ["apiErr.restaurantNotFound", 404],
  already_owner: ["apiErr.alreadyOwner", 409],
  not_on_team: ["apiErr.notOnTeam", 409],
};

// POST /api/admin/restaurants/owner { id, userId } — the restaurant becomes
// userId's; they must already be on its team. The former owner stays on as a
// manager. Written in the restaurant's activity log.
async function transfer(req: NextRequest) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ id?: unknown; userId?: unknown }>(req);
  if (!body || typeof body.id !== "string" || typeof body.userId !== "string") return await apiError("apiErr.invalidRequest", 400);
  const { data, error } = await createAdminClient().rpc("admin_transfer_ownership", { p_restaurant: body.id, p_new_owner: body.userId });
  if (error) return await apiError("apiErr.generic", 500);
  if (data !== "transferred") {
    const [key, status] = ANSWERS[String(data)] ?? ["apiErr.generic", 500];
    return await apiError(key, status);
  }
  await logEvent({ restaurantId: body.id, actor: admin.email, entity: "settings", action: "updated",
    detail: logDetail({ owner: "transferred", by: "platform_admin" }) });
  return NextResponse.json({ ok: true });
}

export const POST = auditedAdminAction("restaurant.owner_transfer", transfer);
