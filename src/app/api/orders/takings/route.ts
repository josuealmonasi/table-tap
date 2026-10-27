import { NextResponse } from "next/server";
import { actingManager } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { getMembership } from "@/lib/membership";
import { collectedToday } from "@/lib/collected-today";
import { startOfLocalDay } from "@/lib/day-window";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";

export const dynamic = "force-dynamic";

/** Restaurant-wide money is a manager's read, always scoped by their membership. */
export async function GET() {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const membership = await getMembership();
  if (!membership || membership.restaurant.id !== actor.restaurantId)
    return await apiError("apiErr.forbidden", 403);
  const r = membership.restaurant;
  const dayStart = startOfLocalDay(new Date(), r.timezone ?? DEFAULT_TIME_ZONE);
  const collected = await collectedToday(actor.restaurantId, r.currency, dayStart);
  return NextResponse.json({ restaurantId: r.id, currency: r.currency, collectedToday: collected }, { headers: { "Cache-Control": "private, no-store" } });
}
