import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { getPlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/admin/restaurants/notes?id= — the platform team's notes, newest first.
export async function GET(req: NextRequest) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID.test(id)) return await apiError("apiErr.invalidRequest", 400);
  const { data, error } = await createAdminClient().from("restaurant_admin_notes")
    .select("id, author, body, created_at").eq("restaurant_id", id).order("created_at", { ascending: false }).limit(100);
  if (error) return await apiError("apiErr.generic", 500);
  return NextResponse.json({ notes: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/admin/restaurants/notes { id, body } — adds one, signed by the admin.
export async function POST(req: NextRequest) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<{ id?: unknown; body?: unknown }>(req);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!body || typeof body.id !== "string" || !UUID.test(body.id) || !text || text.length > 2000) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const db = createAdminClient();
  const { data: restaurant } = await db.from("restaurants").select("id").eq("id", body.id).maybeSingle();
  if (!restaurant) return await apiError("apiErr.restaurantNotFound", 404);
  const { error } = await db.from("restaurant_admin_notes").insert({ restaurant_id: body.id, author: admin.email, body: text });
  if (error) return await apiError("apiErr.generic", 500);
  return NextResponse.json({ ok: true });
}
