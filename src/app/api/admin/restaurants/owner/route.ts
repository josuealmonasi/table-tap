import { NextRequest, NextResponse } from "next/server";
import { auditedAdminAction, type AdminAuditContext } from "@/lib/admin-audit";
import { apiError } from "@/lib/api-error";
import { getPlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ANSWERS: Record<string, [string, number]> = {
  not_found: ["apiErr.restaurantNotFound", 404],
  already_owner: ["apiErr.alreadyOwner", 409],
  not_on_team: ["apiErr.notOnTeam", 409],
  owns_another: ["apiErr.ownerOwnsAnother", 409],
};

// POST /api/admin/restaurants/owner { id, userId } — the restaurant becomes
// userId's; they must already be on its team. The former owner stays on as a
// manager, and the extra digest addresses the former owner confirmed are
// cleared (the new owner re-adds them). Written in the restaurant's activity log.
async function transfer(_req: NextRequest, { body }: AdminAuditContext) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);
  if (!body || typeof body.id !== "string" || typeof body.userId !== "string" || !UUID.test(body.id) || !UUID.test(body.userId)) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const { data, error } = await createAdminClient().rpc("admin_transfer_ownership_v2", { p_restaurant: body.id, p_new_owner: body.userId });
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
