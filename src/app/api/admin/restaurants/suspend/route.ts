import { NextRequest, NextResponse } from "next/server";
import { auditedAdminAction, type AdminAuditContext } from "@/lib/admin-audit";
import { apiError } from "@/lib/api-error";
import { getPlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { setSuspension, SUSPENSION_REASONS, type SuspensionReason } from "@/lib/admin-suspend";

export const runtime = "nodejs";

// POST /api/admin/restaurants/suspend { id, reason } — no new sales until lifted.
async function suspend(_req: NextRequest, { body }: AdminAuditContext) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);
  if (!body || typeof body.id !== "string" || !SUSPENSION_REASONS.includes(body.reason as SuspensionReason)) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const answer = await setSuspension(createAdminClient(), body.id, { reason: body.reason as SuspensionReason }, admin.email);
  return answer.ok ? NextResponse.json({ ok: true }) : await apiError(answer.error, answer.status);
}

// DELETE /api/admin/restaurants/suspend { id, suspendedAt } — lifts the
// suspension the admin saw (suspendedAt); a newer one answers 409. Required:
// a lift that names no suspension would clear whichever one exists.
async function lift(_req: NextRequest, { body }: AdminAuditContext) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);
  if (!body || typeof body.id !== "string") return await apiError("apiErr.invalidRequest", 400);
  const seen = body.suspendedAt;
  if (typeof seen !== "string" || !Number.isFinite(Date.parse(seen))) {
    return await apiError("apiErr.suspendedAtRequired", 400);
  }
  const answer = await setSuspension(createAdminClient(), body.id, null, admin.email, seen);
  return answer.ok ? NextResponse.json({ ok: true }) : await apiError(answer.error, answer.status);
}

export const POST = auditedAdminAction("restaurant.suspend", suspend);
export const DELETE = auditedAdminAction("restaurant.unsuspend", lift);
