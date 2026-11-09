import type { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_TIME_ZONE, openMenuIds, type MenuOpenState } from "@/lib/open-menus";
import { tierIncludes } from "@/lib/plan-server";

/**
 * Whether any menu is serving now, and whether a dish belongs to one.
 *
 * A menu switched off — or outside its opening hours — stops being orderable,
 * not just invisible. Without this a page left open through closing time could
 * still check out, and so could a hand-made request.
 */
export async function orderableNow(
  supabase: ReturnType<typeof createAdminClient>,
  restaurantId: string,
): Promise<{ closedNow: boolean; onOpenMenu: (menuId: string | null) => boolean }> {
  const [menusRes, zoneRes] = await Promise.all([
    supabase
      .from("menus")
      .select("id, active, schedule")
      .eq("restaurant_id", restaurantId),
    supabase.from("restaurants").select("timezone").eq("id", restaurantId).single(),
  ]);
  const { ids: openIds, closedNow } = openMenuIds(
    (menusRes.data as MenuOpenState[] | null) ?? [],
    (zoneRes.data as { timezone?: string } | null)?.timezone ?? DEFAULT_TIME_ZONE,
    { schedules: await tierIncludes(restaurantId, "menuSchedules") },
  );
  /** Extras have their own menu too; an open parent cannot open a closed extra. */
  const onOpenMenu = (menuId: string | null): boolean =>
    menuId !== null && openIds.includes(menuId);
  return { closedNow, onOpenMenu };
}
