import type { MenuItem } from "@/lib/types";
import type { Combo } from "@/lib/promotions";
import type { CartPromo } from "@/lib/pricing";

/** The offers tab is not one of the restaurant's categories: it is ours. */
export const DEALS = "deals";
/** "Lo de siempre": this phone's own usual, a tab only where there is one. */
export const USUAL = "usual";

/** Which products carry an offer, and the name of the first deal covering each. */
export function promoIndex(promos: CartPromo[]): {
  ids: Set<string>;
  nameOf: Map<string, string>;
} {
  const ids = new Set<string>();
  // First deal wins, matching how the pricing engine picks one deal per product.
  const nameOf = new Map<string, string>();
  for (const promo of promos) {
    for (const id of promo.itemIds) {
      ids.add(id);
      if (!nameOf.has(id)) nameOf.set(id, promo.name);
    }
  }
  return { ids, nameOf };
}

/**
 * There is something to show in Offers: a combo, a discounted dish, or one
 * inside a promotion. With none of that the tab does not appear — an empty
 * section is worse than no section.
 */
export function menuHasDeals(
  dealsTabEnabled: boolean | null | undefined,
  combos: Combo[],
  items: MenuItem[],
  promoIds: Set<string>,
): boolean {
  return (
    dealsTabEnabled !== false &&
    (combos.length > 0 ||
      items.some(i => Number(i.discount_pct) > 0 || promoIds.has(i.id)))
  );
}

export interface MenuView {
  search: string;
  activeCat: string;
  diet: string[];
}

/** Search spans the whole menu; the category tabs and the dietary filter narrow it. */
export function filterDishes(
  items: MenuItem[],
  view: MenuView,
  promoIds: Set<string>,
  usualIds: Set<string>,
): MenuItem[] {
  const q = view.search.trim().toLowerCase();
  const { activeCat } = view;
  let list = q
    ? items.filter(
        i =>
          i.name.toLowerCase().includes(q) ||
          (i.description ?? "").toLowerCase().includes(q),
      )
    : activeCat === "all"
      ? items
      : activeCat === DEALS
        ? items.filter(i => Number(i.discount_pct) > 0 || promoIds.has(i.id))
        : activeCat === USUAL
          ? items.filter(i => usualIds.has(i.id))
          : items.filter(i => i.category_id === activeCat);
  // An item must carry EVERY selected dietary tag (e.g. vegan AND gluten-free).
  if (view.diet.length)
    list = list.filter(i => view.diet.every(k => (i.dietary ?? []).includes(k)));
  return list;
}

/**
 * Combos head the list. They're hidden under a dietary filter (a bundle has
 * no tags of its own, so we can't honestly claim it matches) and under a
 * category tab, since a bundle spans categories.
 */
export function filterCombos(combos: Combo[], view: MenuView): Combo[] {
  if (view.diet.length) return [];
  const q = view.search.trim().toLowerCase();
  if (q) return combos.filter(c => c.name.toLowerCase().includes(q));
  return view.activeCat === "all" || view.activeCat === DEALS ? combos : [];
}
