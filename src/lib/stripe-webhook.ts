import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

/**
 * Reading a Stripe webhook, for exactly one event stream.
 *
 * The app takes two kinds of money on two Stripe accounts. A diner's food is a
 * DIRECT charge on the restaurant's own account — that is what stops Stripe
 * billing us MX$13.80 on a MX$300 ticket against MX$0.75 collected — so its
 * events fire there. A restaurant's subscription is charged on ours, so those
 * fire here. Stripe has no endpoint that receives both: "your account" and
 * "connected accounts" are separate subscriptions to separate streams, and it
 * issues a separate signing secret for each.
 *
 * So there are two routes, each verifying against ONE secret. The alternative —
 * one route trying several secrets until one fits — would work, and would also
 * mean the code could no longer tell which account an event came from. A
 * connected-account settlement arriving on the platform endpoint would be paid
 * out exactly the same way. Which endpoint received it is a fact worth keeping.
 */
export interface WebhookRead {
  event?: Stripe.Event;
  /** Sent back to Stripe when the event cannot be trusted. */
  refusal?: NextResponse;
}

/**
 * Verifies the signature on a request against one secret.
 *
 * A 400 tells Stripe to retry, which is right for a secret that has not been
 * configured yet: the events wait rather than being dropped.
 */
export async function readStripeEvent(
  req: NextRequest,
  secret: string | undefined,
  /** Which stream this is, so a failure says which endpoint is misconfigured. */
  stream: "platform" | "connect",
): Promise<WebhookRead> {
  const signature = req.headers.get("stripe-signature");

  if (!signature || !secret) {
    console.error(`stripe webhook (${stream}): no signature or no secret configured`);
    return { refusal: NextResponse.json({ error: "Missing signature" }, { status: 400 }) };
  }

  const body = await req.text(); // the raw body is what the signature covers

  try {
    return { event: stripe.webhooks.constructEvent(body, signature, secret) };
  } catch (err) {
    // Nearly always the wrong secret for this endpoint: the two are easy to
    // swap, and swapped they fail silently apart from this line.
    console.error(`stripe webhook (${stream}): signature verification failed`, err);
    return { refusal: NextResponse.json({ error: "Invalid signature" }, { status: 400 }) };
  }
}
