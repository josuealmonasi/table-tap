import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingManager } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the bell shows at once. Older ones stay in the table, not on screen. */
const SHOWN = 10;

/**
 * GET /api/notifications — the newest few, and how many are unread.
 *
 * Owner and manager only, which is the same line the table's RLS policy draws:
 * a warning that the last portions are going is only useful to somebody who can
 * order more. Read here with the secret key after the role check, because the
 * unread count has to be counted across all of them rather than the ten shown.
 */
export async function GET(): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const db = createAdminClient();
  const [listed, unread] = await Promise.all([
    db
      .from("notifications")
      .select("id, kind, data, read_at, created_at")
      .eq("restaurant_id", actor.restaurantId)
      .order("created_at", { ascending: false })
      .limit(SHOWN),
    db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", actor.restaurantId)
      .is("read_at", null),
  ]);

  return NextResponse.json({
    notifications: listed.data ?? [],
    unread: unread.count ?? 0,
  });
}

/**
 * POST /api/notifications — mark one as read, or all of them.
 *
 * Read is a timestamp, and the row stays in the list either way: the point of
 * the bell is that you can go back and see what it told you. Marking something
 * already read again is deliberately allowed to do nothing rather than fail —
 * two tabs open is not an error.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const { id, all } = (await req.json().catch(() => ({}))) as {
    id?: string;
    all?: boolean;
  };
  if (!id && all !== true) return await apiError("apiErr.badRequest", 400);

  let query = createAdminClient()
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("restaurant_id", actor.restaurantId)
    .is("read_at", null);
  if (!all) query = query.eq("id", id!);

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
