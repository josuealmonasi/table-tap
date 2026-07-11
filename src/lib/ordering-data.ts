import { createClient } from "@/lib/supabase/server";
import type { Category, MenuItem, Restaurant } from "@/lib/types";

/** Everything the customer ordering screens need for one restaurant. */
export interface OrderingData {
  restaurant: Restaurant | null;
  categories: Category[];
  items: MenuItem[];
  extras: MenuItem[];
  /** product_id → addon_id[] */
  extrasByProduct: Record<string, string[]>;
}

// Sentinel so an `.in("menu_id", [])` never matches (a restaurant with no active menus).
const NO_MENU = "00000000-0000-0000-0000-000000000000";

/**
 * Loads a restaurant's customer-facing menu — only ACTIVE menus and AVAILABLE
 * items, with the narrowed public `restaurants` columns. Shared by the
 * fast-food route (/r/[id]) and the table route (/r/[id]/t/[tableId]); the
 * table route additionally loads its table.
 */
export async function loadOrderingData(restaurantId: string): Promise<OrderingData> {
  const supabase = await createClient();

  // Only active menus are shown to customers (the union of their content).
  const { data: activeMenus } = await supabase
    .from("menus")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("active", true);
  const activeMenuIds = ((activeMenus as { id: string }[] | null) ?? []).map(m => m.id);
  const menuFilter = activeMenuIds.length ? activeMenuIds : [NO_MENU];

  const [{ data: restaurant }, { data: categories }, { data: menuItems }] =
    await Promise.all([
      // Only the customer-facing columns (never owner_id / created_at).
      supabase
        .from("restaurants")
        .select(
          "id, name, tagline, logo, currency, service_pct, service_enabled, accepting_orders",
        )
        .eq("id", restaurantId)
        .single(),
      supabase
        .from("categories")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .in("menu_id", menuFilter)
        .order("sort_order"),
      // Products AND available add-on items; split client-side.
      supabase
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("available", true)
        .in("menu_id", menuFilter)
        .order("sort_order"),
    ]);

  const allItems = (menuItems as MenuItem[]) ?? [];
  const items = allItems.filter(i => !i.is_addon);
  const extras = allItems.filter(i => i.is_addon);

  // Which extras each product offers (product_id → addon_id[]).
  const extrasByProduct: Record<string, string[]> = {};
  const productIds = items.map(i => i.id);
  if (productIds.length) {
    const { data: links } = await supabase
      .from("item_addons")
      .select("product_id, addon_id")
      .in("product_id", productIds);
    for (const { product_id, addon_id } of (links as
      { product_id: string; addon_id: string }[] | null) ?? []) {
      (extrasByProduct[product_id] ??= []).push(addon_id);
    }
  }

  // With the service charge switched off, customers see a plain 0% everywhere
  // (cart math and checkout both key off service_pct).
  const r = restaurant as Restaurant | null;
  if (r && !r.service_enabled) r.service_pct = 0;

  return {
    restaurant: r,
    categories: (categories as Category[]) ?? [],
    items,
    extras,
    extrasByProduct,
  };
}
