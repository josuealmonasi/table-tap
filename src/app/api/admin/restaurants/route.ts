import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { getPlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// DELETE /api/admin/restaurants — a platform admin erases a restaurant and
// everything under it (menus, orders, tables, staff rows cascade via FK).
// The founding owner's LOGIN survives; delete it separately if wanted.
export async function DELETE(req: NextRequest) {
  const admin = await getPlatformAdmin();
  if (!admin) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<Record<string, unknown>>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { id } = body;
  if (!id) return await apiError("apiErr.invalidRequest", 400);

  const db = createAdminClient();

  // Staff logins would be orphaned auth users once their rows cascade — remove
  // the logins themselves first.
  const { data: members } = await db
    .from("staff")
    .select("user_id")
    .eq("restaurant_id", id);
  for (const m of members ?? []) {
    await db.auth.admin.deleteUser(m.user_id);
  }

  const { error } = await db.from("restaurants").delete().eq("id", id);
  if (error) return await apiError("apiErr.restaurantDelete", 500);

  return NextResponse.json({ ok: true });
}
