import { NextRequest, NextResponse } from "next/server";
import { auditedAdminAction, type AdminAuditContext } from "@/lib/admin-audit";
import { apiError } from "@/lib/api-error";
import { getPlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { changeTrial } from "@/lib/admin-trial";

export const runtime = "nodejs";

// PATCH /api/admin/restaurants/trial { id, endsAt } — extend a trial to a date,
// or end it now with endsAt: null (drops to Carta like an expired trial).
async function trial(_req: NextRequest, { body }: AdminAuditContext) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);
  if (!body || typeof body.id !== "string" || !(body.endsAt === null || typeof body.endsAt === "string")) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const answer = await changeTrial(createAdminClient(), body.id, body.endsAt as string | null, admin.email);
  return answer.ok ? NextResponse.json({ ok: true }) : await apiError(answer.error, answer.status);
}

export const PATCH = auditedAdminAction("restaurant.trial", trial);
