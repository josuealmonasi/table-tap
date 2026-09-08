import { NextRequest, NextResponse } from "next/server";
import { readStripeEvent } from "@/lib/stripe-webhook";
import { abandonCheckout, settleCheckout } from "@/lib/checkout-settle";
import type Stripe from "stripe";

export const runtime = "nodejs";

// POST /api/webhooks/stripe/connect — events on the RESTAURANTS' accounts.
//
// A diner's food is a direct charge on the restaurant's own Stripe account, so
// this is where the money a diner pays is confirmed. It is also the only place
// a payment is believed: a browser coming back from Stripe proves nothing, the
// signature on this request does.
//
// Register it in Stripe as "events on connected accounts" and give it its own
// signing secret — Stripe issues a separate one per endpoint, and using the
// platform's here fails every event with a 400 that looks like a delivery
// problem.
export async function POST(req: NextRequest) {
  const { event, refusal } = await readStripeEvent(
    req,
    process.env.STRIPE_WEBHOOK_SECRET_CONNECT,
    "connect",
  );
  if (refusal) return refusal;

  if (event!.type === "checkout.session.completed") {
    await settleCheckout(event!.data.object as Stripe.Checkout.Session);
  }

  // Opened Stripe Checkout and never paid. Give the coupon use back so a
  // limited code is not burned by an abandoned cart, and clear the order that
  // will never be paid for.
  if (event!.type === "checkout.session.expired") {
    await abandonCheckout(event!.data.object as Stripe.Checkout.Session);
  }

  return NextResponse.json({ received: true });
}
