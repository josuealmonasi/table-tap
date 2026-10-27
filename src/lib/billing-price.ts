import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { planLabel, type PlanLimits } from "@/lib/plan";
import { registerSubscriptionPrice } from "@/lib/subscription-price";
import { currentPrice } from "@/lib/founding";

// Catalog numbers are pesos. The menu's currency never prices a subscription.
export const BILLING_CURRENCY = "mxn";
export async function checkoutPrice(limits: PlanLimits, taken: number): Promise<Stripe.Checkout.SessionCreateParams.LineItem> {
  if (limits.stripe_price_id) {
    const price = await stripe.prices.retrieve(limits.stripe_price_id);
    if (price.currency !== BILLING_CURRENCY || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1 || !price.active) {
      throw new Error("Billing price must be an active monthly MXN price");
    }
    // The plan screen shows currentPrice: a configured Price for any other
    // amount would charge what nobody was shown.
    if (price.unit_amount !== Math.round(currentPrice(limits, taken) * 100)) {
      throw new Error("Billing price does not match the price shown on the plan screen");
    }
    await registerSubscriptionPrice(price.id, limits.plan);
    return { price: price.id, quantity: 1 };
  }
  // The catalogue lives in our database, so a tier with no Stripe Price of
  // its own is still buyable: the line item is built from the same number
  // the plan screen showed them.
  const cents = Math.round(currentPrice(limits, taken) * 100);
  const price = await stripe.prices.create({
    currency: BILLING_CURRENCY, unit_amount: cents,
    recurring: { interval: "month" },
    product_data: { name: `TableTap ${planLabel(limits.plan)}` },
  }, { idempotencyKey: `tt-plan-${limits.plan}-${cents}`, timeout: 30000, maxNetworkRetries: 1 });
  await registerSubscriptionPrice(price.id, limits.plan);
  return { quantity: 1, price: price.id };
}
