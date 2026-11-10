import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPlanName } from "@/lib/billing";
import type { PlanName } from "@/lib/plan";

/** The actual Price grants the tier; old subscription metadata can be stale. */
export async function subscriptionPlan(
  sub: Stripe.Subscription, database?: ReturnType<typeof createAdminClient>,
): Promise<PlanName> {
  if (sub.items.data.length !== 1) throw new Error(`Subscription ${sub.id} needs one mapped Price`);
  const price = sub.items.data[0].price.id;
  const db = database ?? createAdminClient();
  const { data: registered, error } = await db.from("restaurant_subscription_prices")
    .select("plan").eq("price_id", price).maybeSingle();
  if (error) throw new Error(`Subscription Price lookup failed: ${error.message}`);
  let plan = readPlanName(registered?.plan);
  if (!plan) {
    // Configured Prices predate the registry. They are server-owned too.
    const { data, error } = await db.from("plan_limits")
      .select("plan").eq("stripe_price_id", price).maybeSingle();
    if (error) throw new Error(`Catalogue Price lookup failed: ${error.message}`);
    plan = readPlanName(data?.plan);
  }
  if (!plan) throw new Error(`Unmapped subscription Price ${price}`);
  if (sub.metadata.plan !== plan) {
    // Portal or operator Price changes do not rewrite subscription metadata.
    console.warn("Subscription metadata differs from its Price", sub.id, sub.metadata.plan, plan);
  }
  return plan;
}

/** Register before a checkout URL or a changed subscription can be used. */
export async function registerSubscriptionPrice(price: string, plan: PlanName): Promise<void> {
  const db = createAdminClient();
  const { error } = await db.from("restaurant_subscription_prices")
    .upsert({ price_id: price, plan }, { onConflict: "price_id", ignoreDuplicates: true });
  if (error) throw new Error(`Subscription Price registration failed: ${error.message}`);
  const { data, error: readError } = await db.from("restaurant_subscription_prices")
    .select("plan").eq("price_id", price).maybeSingle();
  if (readError || data?.plan !== plan) throw new Error(`Subscription Price ${price} has a conflicting tier`);
}
