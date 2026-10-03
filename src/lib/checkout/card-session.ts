import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";

export interface CardSessionInput {
  /** The restaurant's own Stripe account: the charge is a direct one. */
  stripeAccount: string;
  lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
  /** The coupon and any quantity deal, as money off the whole order. */
  amountOffCents: number;
  /** Shown on the Stripe receipt beside the discount. */
  couponCode: string | null;
  /** Lower-case ISO code. */
  currency: string;
  origin: string;
  orderId: string;
  restaurantId: string;
  tableId: string | null;
  /** Our cut, in cents. Zero sends none. */
  appFee: number;
}

/**
 * The Stripe Checkout page a pay-now order is paid on.
 *
 * Item discounts are already baked into each line's unit_amount. What's left —
 * the coupon and any quantity deal — is money off the order as a whole, and
 * Stripe has no negative line item, so it goes on as a one-off coupon. The
 * line items minus this equals the order's total exactly.
 *
 * Throws what Stripe throws; the caller removes the pending order and gives
 * back what it reserved.
 */
export async function openCardSession(
  p: CardSessionInput,
): Promise<Stripe.Checkout.Session> {
  const discounts =
    p.amountOffCents > 0
      ? [
          {
            coupon: (
              await stripe.coupons.create(
                {
                  amount_off: p.amountOffCents,
                  currency: p.currency,
                  duration: "once",
                  name: p.couponCode ? `Coupon ${p.couponCode}` : "Discount",
                },
                // Same account as the session below, or Stripe cannot find the
                // coupon when the checkout page loads.
                { stripeAccount: p.stripeAccount },
              )
            ).id,
          },
        ]
      : undefined;

  // A DIRECT charge: the payment is created on the restaurant's own Stripe
  // account, so Stripe's processing fee comes out of their balance and our
  // application fee comes to us clean.
  //
  // It used to be a destination charge on the platform, which meant Stripe
  // billed US for every order a diner paid: MX$13.80 on a MX$300 ticket
  // against MX$0.75 collected. Every restaurant we signed made that worse.
  // Settling a table already worked this way — now both paths do.
  return stripe.checkout.sessions.create(
    {
      mode: "payment",
      line_items: p.lineItems,
      ...(discounts ? { discounts } : {}),
      success_url: `${p.origin}/order/${p.orderId}?paid=1`,
      cancel_url: `${p.origin}/r/${p.restaurantId}${p.tableId ? `/t/${p.tableId}` : ""}?cancelled=1`,
      // Stock is taken before the diner reaches this page and comes back when
      // Stripe says the session expired. Left to Stripe's default that is
      // twenty-four hours, so one diner closing a tab holds the last portions
      // of a dish off the menu for a day. Thirty minutes is Stripe's floor and
      // longer than anyone is still deciding.
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      metadata: { order_id: p.orderId },
      payment_intent_data: {
        metadata: { order_id: p.orderId },
        ...(p.appFee > 0 ? { application_fee_amount: p.appFee } : {}),
      },
    },
    { stripeAccount: p.stripeAccount },
  );
}
