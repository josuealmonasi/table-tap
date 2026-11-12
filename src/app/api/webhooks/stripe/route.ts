import { NextRequest, NextResponse } from "next/server";
import { readStripeEvent } from "@/lib/stripe-webhook";
import { applySubscription } from "@/lib/subscription-sync";
import { enqueueCreatedFee } from "@/lib/refunds/created-fee";
import type Stripe from "stripe";

export const runtime = "nodejs";

// POST /api/webhooks/stripe — events on OUR OWN Stripe account.
//
// Subscriptions and application fees belong to the platform account.
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

  // Subscribe the platform endpoint to application_fee.created. The object
  // can appear after an earlier refund check; persist another recovery pass
  // before acknowledging. Duplicate deliveries only advance the queue.
  if (event!.type === "application_fee.created") {
    await enqueueCreatedFee(event!.data.object as Stripe.ApplicationFee);
  }

  // A subscription started, changed tier, lapsed or ended. Every one of those
  // arrives as the same event, and the subscription itself carries the truth —
  // so there is one handler rather than one per transition.
  if (event!.type.startsWith("customer.subscription.")) {
    await applySubscription(event!.data.object as Stripe.Subscription);
  }

  return NextResponse.json({ received: true });
}
