import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { FOUNDING_SLOTS } from "@/lib/founding";
import { closeSessionsFor } from "@/lib/table-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { readPlanName, subscriptionOutcome } from "@/lib/billing";
import type Stripe from "stripe";
import { queueSlips } from "@/lib/print-queue";
import type { Order } from "@/lib/types";

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
      const { data: settled } = await db
        .from("orders")
        .update({ paid: true, pay_method: "card" })
        .in("id", settleIds)
        .select("session_id");

      // Paid in full is the ordinary way a table empties.
      await closeSessionsFor(settled ?? [], "paid");

      // Our cut of this settlement, recorded on the first of the settled
      // orders — the same row that carries the tip. It is what the monthly
      // ceiling is summed from, so it has to land only once a payment is real.
      const fee = Number(session.metadata?.settle_fee ?? 0);
      if (fee > 0) {
        await db.from("orders").update({ platform_fee: fee }).eq("id", settleIds[0]);
      }

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

      // Now it really is the kitchen's: the money is confirmed. Before this the
      // sheet would be for an order that might still go unpaid.
      const { data: full } = await supabase
        .from("orders")
        .select("*")
        .eq("id", orderId)
        .maybeSingle();
      if (full) await queueSlips(full as Order);

      // A pay-now order can be the only thing the table owed.
      const { data: justPaid } = await supabase
        .from("orders")
        .select("session_id")
        .eq("id", orderId)
        .maybeSingle();
      await closeSessionsFor(justPaid ? [justPaid] : [], "paid");

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

  // A subscription started, changed tier, lapsed or ended. Every one of those
  // arrives as the same event, and the subscription itself carries the truth —
  // so there is one handler rather than one per transition.
  if (event.type.startsWith("customer.subscription.")) {
    await applySubscription(event.data.object as Stripe.Subscription);
  }

  return NextResponse.json({ received: true });
}

/**
 * Writes a subscription's state onto the restaurant that owns it.
 *
 * The metadata set at checkout is the only thing trusted here: a webhook is
 * unauthenticated apart from its signature, so which restaurant and which tier
 * must come from what we ourselves stamped on the subscription.
 *
 * `deleted` events arrive with status `canceled`, which the mapping already
 * turns into a free customer rather than a locked one.
 */
async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const restaurantId = sub.metadata?.restaurant_id;
  const plan = readPlanName(sub.metadata?.plan);
  if (!restaurantId || !plan) {
    console.error("subscription without our metadata", sub.id);
    return;
  }

  const outcome = subscriptionOutcome(sub.status, plan);
  const db = createAdminClient();

  // The founding place is taken on subscribing, not on signing up: if signup
  // counted, free registrations would eat the places without anyone ever
  // having paid. If they are already a founder they keep their number.
  if (outcome.status === "active" || outcome.status === "trialing") {
    const { data: number, error: claimError } = await db.rpc("claim_founding_price", {
      p_restaurant: restaurantId,
      p_limit: FOUNDING_SLOTS,
    });
    if (claimError) console.error("founding claim failed", restaurantId, claimError.message);

    // Two restaurants subscribing in the same second can both see the founding
    // price with room for only one. Whoever was already charged that price is
    // honoured: charging a founder's price and not making them one would be
    // keeping their money under a promise we never meant to keep.
    if (number === null && (await paidFoundingPrice(db, sub, plan))) {
      await db.rpc("claim_founding_price", {
        p_restaurant: restaurantId,
        p_limit: FOUNDING_SLOTS + 25,
      });
    }
  }

  // What Stripe actually charges them, so the Plan screen does not show the
  // catalogue price to somebody who subscribed at another.
  const charged = sub.items?.data?.[0]?.price?.unit_amount;

  const { error } = await db
    .from("restaurants")
    .update({
      plan: outcome.plan,
      plan_status: outcome.status,
      stripe_subscription_id: sub.id,
      ...(typeof charged === "number" ? { subscribed_price: charged / 100 } : {}),
      // The trial is Stripe's to run once there is a subscription; ours only
      // covers the stretch before one exists.
      trial_ends_at: null,
    })
    .eq("id", restaurantId);

  if (error) console.error("subscription update failed", sub.id, error.message);
}

/**
 * Was this subscription charged the founding price?
 *
 * Compared against the plan's base price, which is exactly the one only
 * founders pay once the places have run out.
 */
async function paidFoundingPrice(
  db: ReturnType<typeof createAdminClient>,
  sub: Stripe.Subscription,
  plan: string,
): Promise<boolean> {
  const charged = sub.items?.data?.[0]?.price?.unit_amount;
  if (typeof charged !== "number") return false;
  const { data } = await db
    .from("plan_limits")
    .select("monthly_price")
    .eq("plan", plan)
    .maybeSingle();
  const founding = (data as { monthly_price: number } | null)?.monthly_price;
  return typeof founding === "number" && Math.round(founding * 100) === charged;
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
