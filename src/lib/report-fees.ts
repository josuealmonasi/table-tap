import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow, everyRowIn } from "@/lib/paged";

interface KeptFee {
  cents: number;
  refunded_cents: number;
  stripe_payment_intent: string | null;
}

/** The fees we kept on payments settled since `since`, in the report's
 * currency: the costs screen's figure. The saved checkout is the charge's
 * currency evidence; today's menu setting cannot relabel a historical fee.
 * Older fees with no evidence stay outside the rate and are called out. */
export async function feesKeptSince(restaurantId: string, since: string, currency: string): Promise<{ kept: number; unverified: number }> {
  const db = createAdminClient();
  const fees = await everyRow<KeptFee>((a, b) => db.from("platform_fees")
    .select("cents, refunded_cents, stripe_payment_intent")
    .eq("restaurant_id", restaurantId).eq("status", "taken").gte("settled_at", since)
    .order("id").range(a, b), "the fees kept");
  const checkouts = await everyRowIn<{ stripe_payment_intent: string; currency: string }>(
    fees.flatMap(f => f.stripe_payment_intent ? [f.stripe_payment_intent] : []),
    (ids, a, b) => db.from("diner_checkouts").select("stripe_payment_intent, currency")
      .eq("restaurant_id", restaurantId).in("stripe_payment_intent", ids).order("id").range(a, b), "the fees' charge currencies");
  const currencies = new Map(checkouts.map(c => [c.stripe_payment_intent, c.currency]));
  let cents = 0;
  let unverified = 0;
  for (const fee of fees) {
    const original = fee.stripe_payment_intent ? currencies.get(fee.stripe_payment_intent) : undefined;
    if (!original) unverified++;
    else if (original === currency) cents += Number(fee.cents) - Number(fee.refunded_cents);
  }
  return { kept: cents / 100, unverified };
}
