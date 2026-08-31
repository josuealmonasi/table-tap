import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Category, MenuItem, Restaurant } from "@/lib/types";
import { fetchPromotions } from "@/lib/promotions-data";
import { buildCombos, toCartPromos, type Combo } from "@/lib/promotions";
import { DEFAULT_TIME_ZONE, openMenuIds, type MenuOpenState } from "@/lib/open-menus";
import type { CartPromo } from "@/lib/pricing";
import { mailConfigured } from "@/lib/mail";
import type { StoredDietaryTag } from "@/lib/dietary";
import { can } from "@/lib/plan";
import { getPlan } from "@/lib/plan-server";

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
  /** The restaurant has menus, but none is serving at this hour. */
  closedNow: boolean;
  /**
   * Whether a receipt can actually be emailed. Without a mail provider the
   * offer is a promise the app can't keep, so it isn't made.
   */
  receipts: boolean;
  /** The restaurant's dietary tags — the list is theirs, not the code's. */
  dietaryTags: StoredDietaryTag[];
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
/**
 * Just enough to draw the shell: does this restaurant show a cover?
 *
 * One indexed row, asked before the menu itself, so the skeleton can reserve
 * the right height. Without it the skeleton has no way to know — Next gives
 * `loading.tsx` no params — and the page jumped by the height of the photo
 * when the data landed.
 */
export async function loadCoverState(
  restaurantId: string,
): Promise<{ exists: boolean; cover: boolean }> {
  const supabase = await createClient();
  const res = await supabase
    .from("restaurants")
    .select("id, cover_url, cover_enabled")
    .eq("id", restaurantId)
    .maybeSingle();
  const row = unwrap(res, "the restaurant") as
    | { cover_url: string | null; cover_enabled: boolean }
    | null;
  return { exists: Boolean(row), cover: Boolean(row?.cover_enabled && row?.cover_url) };
}

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

  // Which menus a customer may order from now. The decision is shared with
  // /api/checkout so the page and the charge can't disagree about what's on
  // offer — a menu that closes while the page sits open must stop both.
  // Everything that only needs the restaurant id goes out in the same wave.
  //
  // It used to be seven round trips in a row — cover, menus, schedule,
  // restaurant, categories, dishes, extras, promotions, ratings and plan — and
  // in production the menu took 1.9 s on queries the database answers in under
  // a millisecond each. The time was not in the database: it was in waiting ten
  // times for the round trip. Promotions, ratings and the plan depend on nothing
  // else, so they have no reason to wait their turn.
  const [menusRes, zoneRes, promotions, statsRes, plan, dietaryRes] = await Promise.all([
    // Read with the service key, and ONLY these three columns, scoped to this
    // restaurant. The public policy on `menus` is `using (active = true)`, so
    // a customer's own query cannot see a switched-off menu — and `closedNow`
    // is defined as "has menus but none open", which that query can never
    // observe. A restaurant that switched everything off served its diners a
    // blank page with no explanation, because the count came back zero and
    // read as "this restaurant has no menus".
    //
    // Nothing hidden reaches the browser: `ids` only ever holds OPEN menus and
    // filters the queries below, and `closedNow` is a boolean.
    createAdminClient()
      .from("menus")
      .select("id, active, schedule")
      .eq("restaurant_id", restaurantId),
    supabase.from("restaurants").select("timezone").eq("id", restaurantId).single(),
    fetchPromotions(supabase, restaurantId, { activeOnly: true }),
    supabase.rpc("dish_rating_stats", { p_restaurant_id: restaurantId }),
    getPlan(restaurantId),
    // The dietary tags depend on nothing else, so they travel with this first
    // group instead of costing another round trip.
    supabase
      .from("dietary_tags")
      .select("id, key, label, label_en, emoji, sort_order")
      .eq("restaurant_id", restaurantId)
      .order("sort_order"),
  ]);
  const menuRows = (menusRes.data as MenuOpenState[] | null) ?? [];
  const timeZone =
    (zoneRes.data as { timezone?: string } | null)?.timezone ?? DEFAULT_TIME_ZONE;
  const { ids: activeMenuIds, closedNow } = openMenuIds(menuRows, timeZone);
  const menuFilter = activeMenuIds.length ? activeMenuIds : [NO_MENU];

  const [restaurantRes, categoriesRes, menuItemsRes] = await Promise.all([
    // Only the customer-facing columns (never owner_id / created_at).
    supabase
      .from("restaurants")
      .select(
        "id, name, tagline, logo, logo_url, currency, service_pct, service_enabled, accepting_orders, tax_pct, tax_show_breakdown, cover_url, cover_enabled, allow_pay_later, deals_tab_enabled",
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

  // Combos are built against live prices and silently dropped when a component
  // sells out, so a card can never be tapped into a failed checkout.
  const itemsById = new Map(items.map(i => [i.id, i]));
  const combos = buildCombos(promotions, itemsById);
  const promos = toCartPromos(promotions);

  // Ratings are aggregates from a security-definer function: it returns an
  // average and a count per dish and nothing that identifies an order, and it
  // withholds dishes below the minimum count entirely. A failure here costs a
  // decoration, so it degrades to "no ratings" rather than taking the menu
  // down with it.
  const ratings: OrderingData["ratings"] = {};
  const stats = statsRes.data;
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

  // Can they take cards? Resolved here because the Stripe columns are not the
  // diner's — their read grant does not include them, and it should stay that
  // way. What reaches the browser is a yes or a no.
  if (restaurant) {
    const { data: pay } = await createAdminClient()
      .from("restaurants")
      .select("stripe_account_id, stripe_charges_enabled")
      .eq("id", restaurantId)
      .maybeSingle();
    restaurant.cards_enabled = Boolean(pay?.stripe_account_id && pay?.stripe_charges_enabled);
  }

  // Taking the food before paying comes with the plan, so the restaurant's own
  // switch is not enough: someone who downgraded to Carta still has it on in
  // the database. Resolved here so the cart never paints a button checkout
  // would reject — the same rule, on both sides.
  if (restaurant?.allow_pay_later) {
    restaurant.allow_pay_later = plan ? can(plan.limits, "deferredPayment") : false;
  }

  return {
    closedNow,
    receipts: mailConfigured(),
    dietaryTags: (dietaryRes.data as StoredDietaryTag[] | null) ?? [],
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
