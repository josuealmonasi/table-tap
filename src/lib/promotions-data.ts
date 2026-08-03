import type { SupabaseClient } from "@supabase/supabase-js";
import type { PromotionRow, PromotionWithItems } from "@/lib/promotions";

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
    .select(PROMO_COLUMNS)
    .eq("restaurant_id", restaurantId)
    .order("sort_order");
  if (activeOnly) query = query.eq("active", true);

  const { data } = await query;
  const promos = (data as PromotionRow[] | null) ?? [];
  if (promos.length === 0) return [];

  const { data: links } = await supabase
    .from("promotion_items")
    .select("promotion_id, item_id, qty")
    .in(
      "promotion_id",
      promos.map(p => p.id),
    );

  const byPromo = new Map<string, { item_id: string; qty: number }[]>();
  for (const row of (links as
    | { promotion_id: string; item_id: string; qty: number }[]
    | null) ?? []) {
    const list = byPromo.get(row.promotion_id) ?? [];
    list.push({ item_id: row.item_id, qty: row.qty });
    byPromo.set(row.promotion_id, list);
  }

  return promos.map(p => ({ ...p, items: byPromo.get(p.id) ?? [] }));
}
