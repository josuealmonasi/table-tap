import type { SupabaseClient } from "@supabase/supabase-js";
import type { PromotionWithItems } from "@/lib/promotions";

const PROMO_COLUMNS =
  "id, restaurant_id, kind, name, emoji, description, combo_price, buy_qty, pay_qty, tiers, active, sort_order";

/**
 * Loads a restaurant's promotions with the items each one covers. Works with
 * any client: the anon key sees only active promotions (RLS), while the secret
 * key used by checkout and the dashboard sees all of them.
 */
export async function fetchPromotions(
  supabase: SupabaseClient,
  restaurantId: string,
  { activeOnly = false }: { activeOnly?: boolean } = {},
): Promise<PromotionWithItems[]> {
  let query = supabase
    .from("promotions")
    .select(`${PROMO_COLUMNS}, items:promotion_items(item_id, qty)`)
    .eq("restaurant_id", restaurantId)
    .order("sort_order");
  if (activeOnly) query = query.eq("active", true);

  // A failed read is not "no promotions". Read that way, checkout priced a cart
  // without the deal the menu had just shown the diner — two for one charged
  // as two — and the till and the waiter's order did the same.
  const { data, error } = await query;
  if (error) throw new Error(`Could not load the promotions: ${error.message}`);
  // The nested relation is one SQL statement: prices and components come from
  // the same snapshot even when a manager saves a replacement during checkout.
  return (data as PromotionWithItems[] | null) ?? [];
}
