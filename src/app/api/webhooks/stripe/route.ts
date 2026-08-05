import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type Stripe from "stripe";

export const runtime = "nodejs";

// POST /api/webhooks/stripe
// Stripe calls this after a successful payment. We verify the signature, then
// mark the order paid + 'received' so it appears on the kitchen dashboard.
export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const body = await req.text(); // raw body required for signature check

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error("Webhook signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id;

    if (orderId && session.payment_status === "paid") {
      const supabase = createAdminClient();
      await supabase
        .from("orders")
        .update({
          paid: true,
          status: "received",
          pay_method: "card",
          stripe_payment_intent:
            typeof session.payment_intent === "string" ? session.payment_intent : null,
        })
        .eq("id", orderId);

      // The coupon use was reserved at checkout; the payment makes it real.
      await supabase
        .from("coupon_redemptions")
        .update({ confirmed_at: new Date().toISOString() })
        .eq("order_id", orderId)
        .is("confirmed_at", null);
    }
  }

  // The customer opened Stripe Checkout and never paid (Stripe expires a
  // session after ~24h). Give the coupon use back so a limited code isn't
  // burned by an abandoned cart, and clear the order that will never be paid.
  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    const orderId = session.metadata?.order_id;
    if (orderId) await releaseAbandonedOrder(orderId);
  }

  return NextResponse.json({ received: true });
}

/**
 * Undoes an unpaid checkout: returns any reserved coupon use, drops the
 * reservation record, and removes the pending order. Safe to run twice —
 * it only ever touches a still-unconfirmed reservation.
 */
async function releaseAbandonedOrder(orderId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data: reservation } = await supabase
    .from("coupon_redemptions")
    .select("id, coupon_id")
    .eq("order_id", orderId)
    .is("confirmed_at", null)
    .maybeSingle();

  if (reservation?.coupon_id) {
    await supabase.rpc("release_coupon", { p_coupon_id: reservation.coupon_id });
  }
  if (reservation?.id) {
    await supabase.from("coupon_redemptions").delete().eq("id", reservation.id);
  }

  // Only ever remove an order that was never paid for.
  await supabase
    .from("orders")
    .delete()
    .eq("id", orderId)
    .eq("status", "pending_payment")
    .eq("paid", false);
}
