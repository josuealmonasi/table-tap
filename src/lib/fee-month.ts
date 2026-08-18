import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What we have already taken from this restaurant in per-order fees this
 * calendar month, in cents.
 *
 * Summed from the orders themselves rather than asked of Stripe: a payment is
 * the worst moment to be waiting on somebody else's API, and the number has to
 * be reconcilable against what the owner can see in their own history.
 *
 * The month is the calendar month in UTC. A restaurant's billing period does
 * not line up with it exactly, which means the ceiling can be a few days out
 * of step at the turn of a month — worth the simplicity until subscriptions
 * are common enough for anyone to notice.
 */
export async function feesTakenThisMonth(restaurantId: string): Promise<number> {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);

  const { data } = await createAdminClient()
    .from("orders")
    .select("platform_fee")
    .eq("restaurant_id", restaurantId)
    .gt("platform_fee", 0)
    .gte("created_at", since.toISOString());

  const pesos = (data ?? []).reduce((sum, o) => sum + Number(o.platform_fee ?? 0), 0);
  return Math.round(pesos * 100);
}
