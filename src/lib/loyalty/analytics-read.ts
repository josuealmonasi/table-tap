// SERVER-ONLY: the rows `loyaltyStats` counts, for one restaurant and period.
import type { SupabaseClient } from "@supabase/supabase-js";
import { loyaltyStats, type LoyaltyStats } from "@/lib/loyalty/analytics";
import { everyRow } from "@/lib/paged";

export async function readLoyaltyStats(
  admin: SupabaseClient,
  restaurantId: string,
  start: Date,
  end: Date,
): Promise<LoyaltyStats> {
  const from = start.toISOString();
  const to = end.toISOString();
  // Every row of the period. `.limit(10000)` did not do it: the server stops
  // each read at its own row cap however many are asked for, without saying
  // so. A failed page throws, rather than counting as none: an unread card
  // table is not a program nobody joined.
  const window = <T>(table: string, columns: string) =>
    everyRow<T>((a, b) => admin.from(table).select(columns).eq("restaurant_id", restaurantId)
      .gte("created_at", from).lt("created_at", to).order("id").range(a, b) as unknown as PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
      `the visit card's ${table}`);
  const [cards, visits, redemptions] = await Promise.all([
    window<{ id: string; created_at: string }>("loyalty_cards", "id, created_at"),
    window<{ card_id: string; visit_day: string; actor_email: string }>("loyalty_visits", "card_id, visit_day, actor_email"),
    window<{ created_at: string }>("loyalty_redemptions", "created_at"),
  ]);
  return loyaltyStats(cards, visits, redemptions);
}
