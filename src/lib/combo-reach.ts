import type { Category, MenuItem } from "@/lib/types";
import type { PromotionWithItems } from "@/lib/promotions";

/**
 * Why a combo can't reach the customer menu.
 *
 * `buildCombos` drops a combo outright when any component is missing from the
 * menu being displayed or is marked unavailable — better no card than one that
 * fails at checkout. The dashboard had no matching signal, so an owner could
 * see a combo listed as active and believe diners could order it while the
 * card never rendered at all.
 */
export interface ComboReachProblem {
  /** The component that breaks it — named so the warning can be specific. */
  itemName: string;
  reason: "unavailable" | "off-menu";
}

/**
 * The first thing stopping this combo from appearing, or null when it's fine.
 *
 * Only the first problem is reported: a combo with three broken components is
 * still one broken combo, and listing all three buries the fix.
 *
 * @param activeMenuIds ids of menus customers can currently see
 */
export function comboReachProblem(
  promo: PromotionWithItems,
  itemsById: Map<string, MenuItem>,
  categoriesById: Map<string, Category>,
  activeMenuIds: Set<string>,
): ComboReachProblem | null {
  if (promo.kind !== "combo") return null;

  for (const { item_id } of promo.items) {
    const item = itemsById.get(item_id);
    // A component that no longer exists can't be named, so report the id's
    // absence as an off-menu problem rather than crashing on undefined.
    if (!item) return { itemName: "", reason: "off-menu" };
    if (!item.available) return { itemName: item.name, reason: "unavailable" };

    const menuId = item.category_id
      ? (categoriesById.get(item.category_id)?.menu_id ?? null)
      : null;
    if (!menuId || !activeMenuIds.has(menuId)) {
      return { itemName: item.name, reason: "off-menu" };
    }
  }
  return null;
}
