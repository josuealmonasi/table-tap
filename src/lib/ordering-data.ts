import { createClient } from "@/lib/supabase/server";
import type { Category, MenuItem, Restaurant } from "@/lib/types";
import { fetchPromotions } from "@/lib/promotions-data";
import { buildCombos, toCartPromos, type Combo } from "@/lib/promotions";
import type { CartPromo } from "@/lib/pricing";

/** Everything the customer ordering screens need for one restaurant. */
export interface OrderingData {
  restaurant: Restaurant | null;
  categories: Category[];
  items: MenuItem[];
  extras: MenuItem[];
  /** product_id → addon_id[] */
  extrasByProduct: Record<string, string[]>;
  /** Bundles shown as their own menu cards. */
  combos: Combo[];
  /** Quantity deals the cart prices and hints about. */
  promos: CartPromo[];
}

// Sentinel so an `.in("menu_id", [])` never matches (a restaurant with no active menus).
const NO_MENU = "00000000-0000-0000-0000-000000000000";

/**
 * Errors that are really answers, not faults.
 *
 * PGRST116 — `.single()` matched no rows: the restaurant isn't there.
 * 22P02    — Postgres couldn't parse the id as a uuid. A value it can't even
 *            read matches nothing by definition, so this is a 404 too. It has
 *            to be listed here or a mistyped QR link would offer the diner a
 *            "try again" button that can never succeed.
 */
const NOT_A_FAULT = new Set(["PGRST116", "22P02"]);

/**
 * Unwraps a Supabase result, telling a real answer apart from a failure.
 *
 * These queries used to be destructured as `{ data }`, dropping `error` on the
 * floor. That turned every transient fault — a network blip, an exhausted
 * connection pool — into a confident lie: a null restaurant became a "page not
 * found" for a customer holding a perfectly valid QR code, and a null item list
 * became an empty menu. Both look permanent and correct, so nobody retries and
 * nothing reaches the logs.
 *
 * The NOT_A_FAULT codes are the ones that ARE an answer: the restaurant
 * genuinely does not exist, so they pass through as null and the caller may
 * 404. Everything else throws, which renders the error boundary ("try again")
 * and surfaces the fault.
 */
export function unwrap<T>(
  res: { data: T | null; error: { code?: string; message: string } | null },
  what: string,
): T | null {
  if (res.error && !NOT_A_FAULT.has(res.error.code ?? "")) {
    throw new Error(`Could not load ${what}: ${res.error.message}`);
  }
  return res.data;
}

/**
 * Loads a restaurant's customer-facing menu — only ACTIVE menus and AVAILABLE
 * items, with the narrowed public `restaurants` columns. Shared by the
 * fast-food route (/r/[id]) and the table route (/r/[id]/t/[tableId]); the
 * table route additionally loads its table.
 */
export async function loadOrderingData(restaurantId: string): Promise<OrderingData> {
  const supabase = await createClient();

  // Only active menus are shown to customers (the union of their content).
  const menusRes = await supabase
    .from("menus")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("active", true);
  const activeMenus = unwrap<{ id: string }[]>(menusRes, "menus") ?? [];
  const activeMenuIds = activeMenus.map(m => m.id);
  const menuFilter = activeMenuIds.length ? activeMenuIds : [NO_MENU];

  const [restaurantRes, categoriesRes, menuItemsRes] = await Promise.all([
    // Only the customer-facing columns (never owner_id / created_at).
    supabase
      .from("restaurants")
      .select(
        "id, name, tagline, logo, currency, service_pct, service_enabled, accepting_orders, tax_pct, tax_show_breakdown",
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

  const restaurant = unwrap<Restaurant>(restaurantRes, "restaurant");
  const categories = unwrap<Category[]>(categoriesRes, "categories") ?? [];
  const allItems = unwrap<MenuItem[]>(menuItemsRes, "menu items") ?? [];
  const items = allItems.filter(i => !i.is_addon);
  const extras = allItems.filter(i => i.is_addon);

  // Which extras each product offers (product_id → addon_id[]).
  const extrasByProduct: Record<string, string[]> = {};
  const productIds = items.map(i => i.id);
  if (productIds.length) {
    const linksRes = await supabase
      .from("item_addons")
      .select("product_id, addon_id")
      .in("product_id", productIds);
    const links =
      unwrap<{ product_id: string; addon_id: string }[]>(linksRes, "item add-ons") ?? [];
    for (const { product_id, addon_id } of links) {
      (extrasByProduct[product_id] ??= []).push(addon_id);
    }
  }

  // Promotions. Combos are built against live prices and silently dropped when
  // a component sells out, so a card can never be tapped into a failed checkout.
  const promotions = await fetchPromotions(supabase, restaurantId, { activeOnly: true });
  const itemsById = new Map(items.map(i => [i.id, i]));
  const combos = buildCombos(promotions, itemsById);
  const promos = toCartPromos(promotions);

  // With the service charge switched off, customers see a plain 0% everywhere
  // (cart math and checkout both key off service_pct).
  if (restaurant && !restaurant.service_enabled) restaurant.service_pct = 0;

  return {
    restaurant,
    categories,
    items,
    extras,
    extrasByProduct,
    combos,
    promos,
  };
}
