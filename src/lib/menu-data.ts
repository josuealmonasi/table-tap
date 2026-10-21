import type { createClient } from "@/lib/supabase/client";
import type { Category, Menu, MenuItem } from "@/lib/types";
import { everyRow, everyRowIn } from "@/lib/paged";

type Supabase = ReturnType<typeof createClient>;

/** Everything the menu editor shows for one restaurant. */
export interface MenuData {
  menus: Menu[];
  sections: Category[];
  products: MenuItem[];
  addons: MenuItem[];
  /** product_id → addon_id[] */
  links: Record<string, string[]>;
}

/** Loads a restaurant's menus, sections, items and product↔add-on links. */
export async function fetchMenuData(
  supabase: Supabase,
  restaurantId: string,
): Promise<MenuData> {
  const read = <T>(table: string) => everyRow<T>(
    (from, to) => supabase.from(table).select("*").eq("restaurant_id", restaurantId)
      .order("sort_order").order("id").range(from, to),
    `the menu's ${table}`,
  );
  const [menuRows, cats, allItems] = await Promise.all([
    read<Menu>("menus"), read<Category>("categories"), read<MenuItem>("menu_items"),
  ]);

  const products = allItems.filter(i => !i.is_addon);

  // Every link, or none: saving a dish's extras replaces the whole set with
  // what the editor holds, so a set read short would be saved short. Thrown,
  // never swallowed.
  const links: Record<string, string[]> = {};
  const linkRows = await everyRowIn<{ product_id: string; addon_id: string }>(
    products.map(p => p.id),
    (slice, from, to) => supabase
      .from("item_addons")
      .select("product_id, addon_id")
      .in("product_id", slice)
      .order("product_id").order("sort_order").order("addon_id")
      .range(from, to),
    "the extras each dish offers",
  );
  for (const row of linkRows) (links[row.product_id] ??= []).push(row.addon_id);

  return {
    menus: menuRows,
    sections: cats,
    products,
    addons: allItems.filter(i => i.is_addon),
    links,
  };
}

export type ReorderTable = "menus" | "categories" | "menu_items";

/** Any row that can be moved up/down within its sibling group. */
export interface Reorderable {
  id: string;
  sort_order: number;
}

/**
 * Swaps sort_order between `id` and its up/down neighbor within `siblings`
 * (already-loaded rows, any order); writes both rows. No-op at either end.
 * Returns the write error, if any, so the caller can surface it.
 */
export async function reorderRows(
  supabase: Supabase,
  table: ReorderTable,
  siblings: Reorderable[],
  id: string,
  direction: "up" | "down",
): Promise<{ message: string } | null> {
  const ordered = [...siblings].sort((a, b) => a.sort_order - b.sort_order);
  const index = ordered.findIndex(x => x.id === id);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= ordered.length) return null;
  const a = ordered[index];
  const b = ordered[swapIndex];
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabase.from(table).update({ sort_order: b.sort_order }).eq("id", a.id),
    supabase.from(table).update({ sort_order: a.sort_order }).eq("id", b.id),
  ]);
  return e1 ?? e2;
}
