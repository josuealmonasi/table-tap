import { NextRequest, NextResponse } from "next/server";
import { getPlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// DELETE /api/admin/restaurants — a platform admin erases a restaurant and
// everything under it (menus, orders, tables, staff rows cascade via FK).
// The founding owner's LOGIN survives; delete it separately if wanted.
export async function DELETE(req: NextRequest) {
  const admin = await getPlatformAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const db = createAdminClient();

  // Staff logins would be orphaned auth users once their rows cascade — remove
  // the logins themselves first.
  const { data: members } = await db.from("staff").select("user_id").eq("restaurant_id", id);
  for (const m of members ?? []) {
    await db.auth.admin.deleteUser(m.user_id);
  }

  const { error } = await db.from("restaurants").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Could not delete the restaurant." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
