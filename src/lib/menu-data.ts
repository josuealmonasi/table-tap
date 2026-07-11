import type { createClient } from "@/lib/supabase/client";
import type { Category, Menu, MenuItem } from "@/lib/types";

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
  const [{ data: menuRows }, { data: cats }, { data: items }] = await Promise.all([
    supabase
      .from("menus")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("sort_order"),
    supabase
      .from("categories")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("sort_order"),
    supabase
      .from("menu_items")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("sort_order"),
  ]);

  const allItems = (items as MenuItem[]) ?? [];
  const products = allItems.filter(i => !i.is_addon);

  const links: Record<string, string[]> = {};
  const productIds = products.map(p => p.id);
  if (productIds.length) {
    const { data: linkRows } = await supabase
      .from("item_addons")
      .select("product_id, addon_id")
      .in("product_id", productIds);
    for (const row of (linkRows as { product_id: string; addon_id: string }[]) ?? []) {
      (links[row.product_id] ??= []).push(row.addon_id);
    }
  }

  return {
    menus: (menuRows as Menu[]) ?? [],
    sections: (cats as Category[]) ?? [],
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
