// SERVER-ONLY: the rows `loyaltyStats` counts, for one restaurant and period.
import type { SupabaseClient } from "@supabase/supabase-js";
import { loyaltyStats, type LoyaltyStats } from "@/lib/loyalty/analytics";

export async function readLoyaltyStats(
  admin: SupabaseClient,
  restaurantId: string,
  start: Date,
  end: Date,
): Promise<LoyaltyStats> {
  const from = start.toISOString();
  const to = end.toISOString();
  const [cards, visits, redemptions] = await Promise.all([
    admin.from("loyalty_cards").select("id, created_at").eq("restaurant_id", restaurantId)
      .gte("created_at", from).lt("created_at", to).limit(10000),
    admin.from("loyalty_visits").select("card_id, visit_day, actor_email").eq("restaurant_id", restaurantId)
      .gte("created_at", from).lt("created_at", to).limit(10000),
    admin.from("loyalty_redemptions").select("created_at").eq("restaurant_id", restaurantId)
      .gte("created_at", from).lt("created_at", to).limit(10000),
  ]);
  // Thrown rather than counted as none: an unread card table is not a program
  // nobody joined.
  const failed = cards.error ?? visits.error ?? redemptions.error;
  if (failed) throw new Error(`Could not read the visit card numbers: ${failed.message}`);
  return loyaltyStats(cards.data ?? [], visits.data ?? [], redemptions.data ?? []);
}
