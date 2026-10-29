import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingManager } from "@/lib/api-guard";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { notificationCursor, notificationPage } from "@/lib/notification-page";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/notifications — unread first, then older entries, and the unread total.
 *
 * Owner and manager only, which is the same line the table's RLS policy draws:
 * a warning that the last portions are going is only useful to somebody who can
 * order more. Read here with the secret key after the role check, because the
 * unread count has to be counted across all of them rather than just the page shown.
 */
export async function GET(req?: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const cursor = notificationCursor(req?.nextUrl.searchParams.get("before") ?? null);
  if (!cursor) return await apiError("apiErr.invalidRequest", 400);
  const db = createAdminClient();
  const [listed, unread] = await Promise.all([
    notificationPage(actor.restaurantId, cursor),
    db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", actor.restaurantId)
      .is("read_at", null),
  ]);
  if (listed.error || unread.error) return await apiError("apiErr.generic", 503);

  const { data: restaurant, error: restaurantError } = await db.from("restaurants")
    .select("timezone").eq("id", actor.restaurantId).maybeSingle();
  if (restaurantError || !restaurant) return await apiError("apiErr.generic", 503);
  return NextResponse.json({
    timeZone: restaurant.timezone ?? DEFAULT_TIME_ZONE,
    notifications: listed.notifications,
    unread: unread.count ?? 0,
    nextCursor: listed.nextCursor,
  });
}

/**
 * POST /api/notifications — mark one as read, or all the entries shown.
 *
 * Read is a timestamp, and the row stays in the list either way: the point of
 * the bell is that you can go back and see what it told you. Marking something
 * already read again is deliberately allowed to do nothing rather than fail —
 * two tabs open is not an error.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<{
    id?: string;
    all?: boolean;
    ids?: unknown;
    restaurantId?: string;
  }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  // A cached bell may outlive an account switch on a shared tablet. The
  // expected restaurant only restricts the actor; it never chooses the scope.
  if (body.restaurantId !== undefined && body.restaurantId !== actor.restaurantId) {
    return await apiError("apiErr.forbidden", 403);
  }
  const { id, all, ids } = body;
  // An unseen refund must stay unread even when the visible page is cleared.
  if (all === true && (!Array.isArray(ids) || ids.length > 100
    || ids.some(value => typeof value !== "string" || value.length > 100))) {
    return await apiError("apiErr.badRequest", 400);
  }
  if (all !== true && (typeof id !== "string" || !id || id.length > 100)) return await apiError("apiErr.badRequest", 400);

  if (all === true && (ids as string[]).length === 0) return NextResponse.json({ ok: true });

  let query = createAdminClient()
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("restaurant_id", actor.restaurantId)
    .is("read_at", null);
  if (all === true) query = query.in("id", ids as string[]);
  else query = query.eq("id", id!);

  const { error } = await query;
  if (error) {
    console.error("notifications update failed:", error.message);
    return await apiError("apiErr.generic", 500);
  }
  return NextResponse.json({ ok: true });
}
