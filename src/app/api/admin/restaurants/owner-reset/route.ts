import { NextRequest, NextResponse } from "next/server";
import { auditedAdminAction } from "@/lib/admin-audit";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { getPlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteOrigin } from "@/lib/site-origin";

export const runtime = "nodejs";

// POST /api/admin/restaurants/owner-reset { id } — sends the restaurant's
// owner the same password-reset email the forgot-password page sends. The
// admin never sees or sets the password; the owner picks a new one.
async function reset(req: NextRequest) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ id?: unknown }>(req);
  if (!body || typeof body.id !== "string") return await apiError("apiErr.invalidRequest", 400);
  const db = createAdminClient();
  const { data: restaurant } = await db.from("restaurants").select("owner_id").eq("id", body.id).maybeSingle();
  if (!restaurant) return await apiError("apiErr.restaurantNotFound", 404);
  if (!restaurant.owner_id) return await apiError("apiErr.ownerMissing", 409);
  const { data: user } = await db.auth.admin.getUserById(restaurant.owner_id as string);
  const email = user?.user?.email;
  if (!email) return await apiError("apiErr.ownerMissing", 409);
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: `${siteOrigin(req)}/auth/callback?next=/reset-password` });
  if (error) return await apiError("apiErr.mailFailed", 502);
  return NextResponse.json({ ok: true });
}

export const POST = auditedAdminAction("restaurant.owner_reset", reset);
