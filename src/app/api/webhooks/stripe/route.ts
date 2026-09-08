import { NextRequest, NextResponse } from "next/server";
import { readStripeEvent } from "@/lib/stripe-webhook";
import { applySubscription } from "@/lib/subscription-sync";
import type Stripe from "stripe";

export const runtime = "nodejs";

// POST /api/webhooks/stripe — events on OUR OWN Stripe account.
//
// That is subscriptions and nothing else: a restaurant paying us every month.
// A diner's food is a direct charge on the restaurant's account and arrives at
// /api/webhooks/stripe/connect instead, signed with a different secret. Two
// accounts, two streams, two endpoints — which is Stripe's model, not a
// workaround for it.
export async function POST(req: NextRequest) {
  const { event, refusal } = await readStripeEvent(
    req,
    process.env.STRIPE_WEBHOOK_SECRET,
    "platform",
  );
  if (refusal) return refusal;

  // A subscription started, changed tier, lapsed or ended. Every one of those
  // arrives as the same event, and the subscription itself carries the truth —
  // so there is one handler rather than one per transition.
  if (event!.type.startsWith("customer.subscription.")) {
    await applySubscription(event!.data.object as Stripe.Subscription);
  }

  return NextResponse.json({ received: true });
}
