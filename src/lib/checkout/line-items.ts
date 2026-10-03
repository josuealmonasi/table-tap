import type Stripe from "stripe";
import { itemSalePrice } from "@/lib/pricing";
import { stripeProductName } from "@/lib/stripe-limits";
import type { OrderLineItem } from "@/lib/types";

export interface LineItemsInput {
  /** The cart as the database priced it. */
  verified: OrderLineItem[];
  /** Lower-case ISO code, as Stripe wants it. */
  currency: string;
  serviceFee: number;
  servicePct: number;
  tip: number;
  /** How the tip was given: an exact amount, or a percentage of the food. */
  tipLabel: string;
}

/**
 * What Stripe Checkout lists and charges, in the smallest currency unit: one
 * line per dish, then the service charge and the tip.
 *
 * Each dish is charged at its sale price. Discounting the line itself (rather
 * than bolting a credit on the end) keeps the Stripe receipt honest about what
 * each item actually cost. What is left — the coupon and any quantity deal — is
 * money off the order as a whole, and goes on the session as a discount.
 */
export function checkoutLineItems(
  input: LineItemsInput,
): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const cur = input.currency;
  const lines: Stripe.Checkout.SessionCreateParams.LineItem[] = input.verified.map(v => {
    const modText = Object.entries(v.mods ?? {})
      .map(([k, val]) => `${k}: ${Array.isArray(val) ? val.join(", ") : val}`)
      .join(" · ");
    const extrasText = v.extras?.length
      ? `Extras: ${v.extras.map(e => e.name).join(", ")}`
      : "";
    const description = [modText, extrasText].filter(Boolean).join(" · ");
    const unitAmount =
      itemSalePrice(v.price, v.discountPct) +
      (v.extras?.reduce((s, e) => s + e.price, 0) ?? 0);
    return {
      quantity: v.qty,
      price_data: {
        currency: cur,
        unit_amount: Math.round(unitAmount * 100),
        product_data: {
          name: stripeProductName(`${v.emoji ? `${v.emoji} ` : ""}${v.name}`),
          ...(description ? { description } : {}),
        },
      },
    };
  });

  if (input.serviceFee > 0) {
    lines.push({
      quantity: 1,
      price_data: {
        currency: cur,
        unit_amount: Math.round(input.serviceFee * 100),
        product_data: { name: `Service charge (${input.servicePct}%)` },
      },
    });
  }

  if (input.tip > 0) {
    lines.push({
      quantity: 1,
      price_data: {
        currency: cur,
        unit_amount: Math.round(input.tip * 100),
        product_data: { name: input.tipLabel },
      },
    });
  }
  return lines;
}
