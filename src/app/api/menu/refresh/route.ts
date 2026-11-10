import { NextResponse } from "next/server";
import { actingManager } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { invalidatePublicMenu } from "@/lib/public-menu-cache";

export const dynamic = "force-dynamic";

/**
 * POST /api/menu/refresh — the menu editor saved something; diners see it now.
 *
 * The editor writes menus, sections, dishes, extras, availability and order
 * straight from the browser under RLS, so no server route ran to clear the
 * public menu cache. Without this, an owner who changed a price or marked a
 * dish sold out and opened their own QR code saw the old menu for up to 30
 * seconds and thought the save had failed. Clears only the caller's own
 * restaurant, and only for someone who may edit its menu.
 */
export async function POST(): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  invalidatePublicMenu(actor.restaurantId);
  return NextResponse.json({ ok: true });
}
