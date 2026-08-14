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
    // A bill settlement pays for several orders at once; a cart checkout pays
    // for the one it just created. Both arrive here, and only here is a
    // payment believed — a browser coming back from Stripe proves nothing.
    const settleIds = (session.metadata?.settle_order_ids ?? "")
      .split(",")
      .map(id => id.trim())
      .filter(Boolean);
    if (settleIds.length > 0 && session.payment_status === "paid") {
      const db = createAdminClient();
      await db
        .from("orders")
        .update({ paid: true, pay_method: "card" })
        .in("id", settleIds);

      // The tip was collected against the table, not a dish, so it is recorded
      // on the first of the settled orders. The takings then match what Stripe
      // actually took, which is the number that has to be right.
      const tip = Number(session.metadata?.settle_tip ?? 0);
      if (tip > 0) {
        const { data: first } = await db
          .from("orders")
          .select("id, tip, total")
          .eq("id", settleIds[0])
          .single();
        if (first) {
          await db
            .from("orders")
            .update({
              tip: Number(first.tip ?? 0) + tip,
              total: Number(first.total ?? 0) + tip,
            })
            .eq("id", first.id);
        }
      }

      // The coupon use was reserved when the bill was sent to Stripe; the
      // payment makes it real, and the code is stamped on the order it paid
      // for so the same orders can never take a second one.
      const settleCoupon = session.metadata?.settle_coupon ?? "";
      if (settleCoupon) {
        await db
          .from("orders")
          .update({
            coupon_code: settleCoupon,
            discount: Number(session.metadata?.settle_discount ?? 0),
          })
          .eq("id", settleIds[0]);
        await db
          .from("coupon_redemptions")
          .update({ confirmed_at: new Date().toISOString() })
          .eq("order_id", settleIds[0])
          .is("confirmed_at", null);
      }
      return NextResponse.json({ received: true });
    }

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
    // A bill that was never paid: the orders are real food already eaten, so
    // only the coupon reservation goes back — the rows stay on the table.
    const settled = (session.metadata?.settle_order_ids ?? "").split(",")[0]?.trim();
    if (settled) {
      await releaseReservation(settled);
      return NextResponse.json({ received: true });
    }

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
/** Hands back an unconfirmed coupon use held against an order. */
async function releaseReservation(orderId: string): Promise<void> {
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
}

async function releaseAbandonedOrder(orderId: string): Promise<void> {
  const supabase = createAdminClient();
  await releaseReservation(orderId);

  // Only ever remove an order that was never paid for.
  await supabase
    .from("orders")
    .delete()
    .eq("id", orderId)
    .eq("status", "pending_payment")
    .eq("paid", false);
}
