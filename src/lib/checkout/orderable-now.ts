import type { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_TIME_ZONE, openMenuIds, type MenuOpenState } from "@/lib/open-menus";
import { tierIncludes } from "@/lib/plan-server";

/**
 * Whether any menu is serving now, and whether a dish's section belongs to one.
 *
 * A menu switched off — or outside its opening hours — stops being orderable,
 * not just invisible. Without this a page left open through closing time could
 * still check out, and so could a hand-made request.
 */
export async function orderableNow(
  supabase: ReturnType<typeof createAdminClient>,
  restaurantId: string,
): Promise<{ closedNow: boolean; onOpenMenu: (categoryId: string | null) => boolean }> {
  const [menusRes, zoneRes, catsRes] = await Promise.all([
    supabase
      .from("menus")
      .select("id, active, schedule")
      .eq("restaurant_id", restaurantId),
    supabase.from("restaurants").select("timezone").eq("id", restaurantId).single(),
    supabase.from("categories").select("id, menu_id").eq("restaurant_id", restaurantId),
  ]);
  const { ids: openIds, closedNow } = openMenuIds(
    (menusRes.data as MenuOpenState[] | null) ?? [],
    (zoneRes.data as { timezone?: string } | null)?.timezone ?? DEFAULT_TIME_ZONE,
    { schedules: await tierIncludes(restaurantId, "menuSchedules") },
  );
  const menuOfCategory = new Map(
    ((catsRes.data as { id: string; menu_id: string | null }[] | null) ?? []).map(c => [
      c.id,
      c.menu_id,
    ]),
  );
  /** Extras have no category of their own; they ride with their product. */
  const onOpenMenu = (categoryId: string | null): boolean => {
    if (!categoryId) return true;
    const menuId = menuOfCategory.get(categoryId);
    return !menuId || openIds.includes(menuId);
  };
  return { closedNow, onOpenMenu };
}
