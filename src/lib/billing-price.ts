import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { planLabel, type PlanLimits } from "@/lib/plan";
import { currentPrice } from "@/lib/founding";

// Catalog numbers are pesos. The menu's currency never prices a subscription.
export const BILLING_CURRENCY = "mxn";
export async function checkoutPrice(limits: PlanLimits, taken: number): Promise<Stripe.Checkout.SessionCreateParams.LineItem> {
  if (limits.stripe_price_id) {
    const price = await stripe.prices.retrieve(limits.stripe_price_id);
    if (price.currency !== BILLING_CURRENCY || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1 || !price.active) {
      throw new Error("Billing price must be an active monthly MXN price");
    }
    return { price: price.id, quantity: 1 };
  }
  // The catalogue lives in our database, so a tier with no Stripe Price of
  // its own is still buyable: the line item is built from the same number
  // the plan screen showed them.
  return { quantity: 1, price_data: {
    currency: BILLING_CURRENCY,
    unit_amount: Math.round(currentPrice(limits, taken) * 100),
    recurring: { interval: "month" },
    product_data: { name: `TableTap ${planLabel(limits.plan)}` },
  } };
}
