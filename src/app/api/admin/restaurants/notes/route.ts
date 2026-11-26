import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { auditedAdminAction, type AdminAuditContext } from "@/lib/admin-audit";
import { getPlatformAdmin } from "@/lib/admin";
import { auditedAdminRead } from "@/lib/admin-read-audit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/admin/restaurants/notes?id= — the platform team's notes, newest
// first. Audited before the read (restaurant.view, view=notes), never with
// the notes' text; no audit, no notes.
export async function GET(req: NextRequest) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!UUID.test(id)) return await apiError("apiErr.invalidRequest", 400);
  let answer;
  try {
    answer = await auditedAdminRead(admin, id, "notes", async () => {
      const { data, error } = await createAdminClient().from("restaurant_admin_notes")
        .select("id, author, body, created_at").eq("restaurant_id", id).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    });
  } catch {
    return await apiError("apiErr.generic", 500);
  }
  if (!answer.audited) return await apiError("apiErr.adminAuditUnavailable", 503);
  return NextResponse.json({ notes: answer.value ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/admin/restaurants/notes { id, body } — adds one, signed by the
// admin. Audited before the write like every other admin action, so a note
// is never saved while the audit stream is down; the audit names the
// restaurant only, never the note's text (requestedFacts copies no `body`).
async function addNote(_req: NextRequest, { body }: AdminAuditContext) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);
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

export const POST = auditedAdminAction("restaurant.note", addNote);
