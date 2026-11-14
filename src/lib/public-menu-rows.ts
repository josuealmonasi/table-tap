import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchPromotions } from "@/lib/promotions-data";
import { programOf } from "@/lib/loyalty/server";
import { everyRow, everyRowIn } from "@/lib/paged";
import { unwrap } from "@/lib/unwrap";
import type { Restaurant, Category, MenuItem } from "@/lib/types";
import type { MenuOpenState } from "@/lib/open-menus";
import type { StoredDietaryTag } from "@/lib/dietary";

export const PUBLIC_RESTAURANT_COLUMNS = "id, name, tagline, logo, logo_url, currency, service_pct, service_enabled, accepting_orders, tax_pct, tax_show_breakdown, cover_url, cover_enabled, allow_pay_later, deals_tab_enabled, split_enabled, timezone";

/** No cookies, storage or signed-in visitor: RLS always sees the anonymous role. */
function anonymousClient() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // The outer cache owns the lifetime; never leave an independently cached fetch.
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  return db;
}

/** The shell stays small; the rest still loads behind Suspense on a cold cache. */
export async function readPublicMenuShell(restaurantId: string) {
  const db = anonymousClient();
  const [restaurantRes, payRes, program] = await Promise.all([
    db.from("restaurants").select(PUBLIC_RESTAURANT_COLUMNS).eq("id", restaurantId).maybeSingle(),
    createAdminClient().from("restaurants").select("stripe_account_id, stripe_charges_enabled").eq("id", restaurantId).maybeSingle(),
    programOf(restaurantId),
  ]);
  const pay = unwrap<{ stripe_account_id: string | null; stripe_charges_enabled: boolean | null }>(payRes, "card readiness");
  return {
    restaurant: unwrap<Restaurant & { timezone?: string }>(restaurantRes, "restaurant"),
    // The account id never enters the cache or the browser; only its readiness does.
    cardsEnabled: Boolean(pay?.stripe_account_id && pay?.stripe_charges_enabled), program,
  };
}

export async function readPublicMenu(restaurantId: string) {
  const db = anonymousClient();
  const admin = createAdminClient();
  const [menus, categories, items, promotions, statsRes, dietaryTags] = await Promise.all([
    // Only the open/closed decision may see inactive menus, exactly as before.
    everyRow<MenuOpenState>((from, to) => admin.from("menus").select("id, active, schedule").eq("restaurant_id", restaurantId).order("id").range(from, to), "menus"),
    everyRow<Category>((from, to) => db.from("categories").select("*").eq("restaurant_id", restaurantId).order("sort_order").order("id").range(from, to), "categories"),
    everyRow<MenuItem>((from, to) => db.from("menu_items").select("*").eq("restaurant_id", restaurantId).eq("available", true).order("sort_order").order("id").range(from, to), "menu items"),
    fetchPromotions(db, restaurantId, { activeOnly: true }),
    db.rpc("dish_rating_stats", { p_restaurant_id: restaurantId }),
    everyRow<StoredDietaryTag>((from, to) => db.from("dietary_tags").select("id, key, label, label_en, emoji, sort_order").eq("restaurant_id", restaurantId).order("sort_order").order("id").range(from, to), "dietary tags"),
  ]);
  const links = await everyRowIn<{ product_id: string; addon_id: string }>(
    items.filter(i => !i.is_addon).map(i => i.id),
    (slice, from, to) => db.from("item_addons").select("product_id, addon_id").in("product_id", slice)
      .order("product_id").order("sort_order").order("addon_id").range(from, to),
    "item add-ons",
  );
  return {
    menus, categories,
    items, links, promotions,
    stats: (statsRes.data ?? []) as { item_id: string; avg_rating: number; rating_count: number }[],
    dietaryTags,
  };
}
