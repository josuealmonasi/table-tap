import type { SupabaseClient } from "@supabase/supabase-js";
import { can } from "@/lib/plan";
import { getPlan } from "@/lib/plan-server";
import { fetchPromotions } from "@/lib/promotions-data";
import type { PromotionWithItems } from "@/lib/promotions";

/**
 * The promotions a sale may use: the restaurant's own, and none on a tier
 * without promotions.
 *
 * Creating one was refused on such a tier, but the ones saved before the move
 * went on showing on the menu and discounting at checkout, the till and the
 * waiter's order — while the owner's screen said promotions come with
 * Servicio, and the terms say a paid plan's features stop with it. The rows
 * are kept as they are: back on a tier with promotions, they run again.
 *
 * Every path that shows or prices a sale reads through here, so the menu and
 * the charge cannot disagree about which deals exist.
 */
export async function promotionsOnSale(
  supabase: SupabaseClient,
  restaurantId: string,
  options?: { activeOnly?: boolean },
): Promise<PromotionWithItems[]> {
  const [plan, promotions] = await Promise.all([
    getPlan(restaurantId),
    fetchPromotions(supabase, restaurantId, options),
  ]);
  return plan && can(plan.limits, "promotions") ? promotions : [];
}
