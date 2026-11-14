import { NextResponse } from "next/server";
import { actingManagerWithRestaurant } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { collectedToday } from "@/lib/collected-today";
import { startOfLocalDay } from "@/lib/day-window";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";

export const dynamic = "force-dynamic";

/**
 * Restaurant-wide money is a manager's read, always scoped by their membership.
 * The restaurant row comes from the same lookup as the guard: asking twice cost
 * a second auth round trip on a read Pedidos polls every 30 s.
 */
export async function GET() {
  const found = await actingManagerWithRestaurant();
  if (!found) return await apiError("apiErr.forbidden", 403);
  const { actor, restaurant: r } = found;
  const dayStart = startOfLocalDay(new Date(), r.timezone ?? DEFAULT_TIME_ZONE);
  const collected = await collectedToday(actor.restaurantId, r.currency, dayStart);
  return NextResponse.json({ restaurantId: r.id, currency: r.currency, collectedToday: collected }, { headers: { "Cache-Control": "private, no-store" } });
}
