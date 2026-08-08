import { createClient } from "@/lib/supabase/server";
import type { Category, MenuItem, Restaurant } from "@/lib/types";
import { fetchPromotions } from "@/lib/promotions-data";
import { buildCombos, toCartPromos, type Combo } from "@/lib/promotions";
import { isMenuOpen, type MenuSchedule } from "@/lib/menu-schedule";
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
  /** item id → average score, for dishes with enough ratings to show one. */
  ratings: Record<string, { avg: number; count: number }>;
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

  // Only menus that are switched on AND inside their opening hours, if they
  // have any. The switch is filtered in SQL; the hours can't be, so they're
  // applied here in the restaurant's own timezone. A menu with no schedule
  // passes straight through, which is how every menu behaved before.
  const [menusRes, zoneRes] = await Promise.all([
    supabase
      .from("menus")
      .select("id, active, schedule")
      .eq("restaurant_id", restaurantId)
      .eq("active", true),
    supabase.from("restaurants").select("timezone").eq("id", restaurantId).single(),
  ]);
  const menuRows =
    unwrap<{ id: string; active: boolean; schedule: MenuSchedule | null }[]>(
      menusRes,
      "menus",
    ) ?? [];
  const timeZone =
    (zoneRes.data as { timezone?: string } | null)?.timezone || "America/Mexico_City";
  const now = new Date();
  const activeMenuIds = menuRows
    .filter(m => isMenuOpen(m.active, m.schedule, now, timeZone))
    .map(m => m.id);
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

  // Ratings are aggregates from a security-definer function: it returns an
  // average and a count per dish and nothing that identifies an order, and it
  // withholds dishes below the minimum count entirely. A failure here costs a
  // decoration, so it degrades to "no ratings" rather than taking the menu
  // down with it.
  const ratings: OrderingData["ratings"] = {};
  const { data: stats } = await supabase.rpc("dish_rating_stats", {
    p_restaurant_id: restaurantId,
  });
  for (const row of (stats as
    { item_id: string; avg_rating: number; rating_count: number }[] | null) ?? []) {
    ratings[row.item_id] = {
      avg: Number(row.avg_rating),
      count: Number(row.rating_count),
    };
  }

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
    ratings,
  };
}
