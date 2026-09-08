import { closeSessionsFor } from "@/lib/table-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordPayment, recordPayments } from "@/lib/payments";
import { releaseStock } from "@/lib/stock-service";
import type { OrderLineItem } from "@/lib/types";
import type Stripe from "stripe";

/**
 * What a completed or abandoned Stripe Checkout means for the money.
 *
 * Lifted out of the webhook route when the platform and connected-account
 * streams were split into two endpoints. All of this belongs to the connected
 * one: it is a diner's food, charged on the restaurant's own Stripe account.
 * Nothing here touches a subscription, which is the other account entirely.
 *
 * SERVER-ONLY. Every write is made with the secret key, because the only thing
 * vouching for the caller is a signature Stripe put on the request.
 */

/**
 * A payment that arrived. Stripe repeats a webhook it is not sure landed, so
 * every path here has to be safe to run twice — the guards are `.eq("paid",
 * false)` and `.is("paid_at", null)` rather than a flag anybody sets.
 */

/**
 * A payment that arrived, routed to the one thing it settles.
 *
 * Three shapes reach this, told apart by what we stamped on the session at
 * checkout: a share of a divided bill, a whole table being settled at once, or
 * a single order paid as it was placed. Stripe repeats a webhook it is not
 * sure landed, so each is written to be safe to run twice — the guards are
 * `.eq("paid", false)` and `.is("paid_at", null)`, never a flag we set.
 */
export async function settleCheckout(session: Stripe.Checkout.Session): Promise<void> {
  // Only here is a payment believed. A browser coming back from Stripe proves
  // nothing: it is the signature on this request that does.
  if (session.payment_status !== "paid") return;

  if (session.metadata?.split_id) return await settleSplitShare(session);
  if ((session.metadata?.settle_order_ids ?? "").trim()) return await settleBill(session);
  if (session.metadata?.order_id) return await settleOrder(session);
}

/**
 * One diner's share of a bill the table agreed to divide.
 *
 * Two things arrive together: the share itself, which belongs to no single
 * order, and whatever this diner ordered after the freeze, which belongs
 * entirely to them. The share is recorded against the sitting; the later
 * orders settle the ordinary way.
 *
 * Only when the last share lands does the food the table divided become paid.
 * Before that the bill is genuinely part-paid, and the floor should see
 * exactly that rather than a table that looks settled and is not.
 */
async function settleSplitShare(session: Stripe.Checkout.Session): Promise<void> {
  // `settleCheckout` only routes here when this is set.
  const splitId = session.metadata?.split_id ?? "";
  const db = createAdminClient();
  const shareNo = Number(session.metadata?.split_share ?? -1);
  const shareAmount = Number(session.metadata?.split_amount ?? 0);

  const { data: split } = await db
    .from("bill_splits")
    .select("id, restaurant_id, session_id, shares, status, locked_at")
    .eq("id", splitId)
    .maybeSingle();

  if (split) {
    // Their seat, marked once — a webhook Stripe repeats must not record
    // the same money twice.
    const { data: claimed } = await db
      .from("bill_split_claims")
      .update({ paid_at: new Date().toISOString() })
      .eq("split_id", splitId)
      .eq("share_no", shareNo)
      .is("paid_at", null)
      .select("share_no");

    if (claimed?.length) {
      await recordPayment({
        restaurantId: split.restaurant_id as string,
        sessionId: split.session_id as string,
        amount: shareAmount,
        method: "card",
        stripePaymentIntent:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
      });

      // Anything they ordered after the freeze is theirs, and settles now.
      const ownIds = (session.metadata?.settle_order_ids ?? "")
        .split(",")
        .map(x => x.trim())
        .filter(Boolean);
      if (ownIds.length > 0) {
        const { data: own } = await db
          .from("orders")
          .update({ paid: true, pay_method: "card" })
          .in("id", ownIds)
          .eq("paid", false)
          .select("id, total, session_id, restaurant_id");
        await recordPayments(
          (own ?? []).map(o => ({
            restaurantId: o.restaurant_id as string,
            orderId: o.id as string,
            sessionId: o.session_id as string | null,
            amount: Number(o.total),
            method: "card" as const,
          })),
        );
      }

      // The last share closes the pot: everything the table divided is
      // paid for, so the orders it covered stop being owed.
      const { count: unpaidShares } = await db
        .from("bill_split_claims")
        .select("share_no", { count: "exact", head: true })
        .eq("split_id", splitId)
        .is("paid_at", null);

      if ((unpaidShares ?? 0) === 0) {
        const { data: covered } = await db
          .from("orders")
          .update({ paid: true, pay_method: "card" })
          .eq("session_id", split.session_id)
          .eq("paid", false)
          .lt("created_at", split.locked_at as string)
          .select("session_id");
        await db
          .from("bill_splits")
          .update({ status: "done" })
          .eq("id", splitId);
        await closeSessionsFor(covered ?? [], "paid");
      }
    }
  }
}

/**
 * A whole table settled in one payment: several orders, one card.
 */
async function settleBill(session: Stripe.Checkout.Session): Promise<void> {
  const settleIds = (session.metadata?.settle_order_ids ?? "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);
  const db = createAdminClient();
  const { data: settled } = await db
    .from("orders")
    .update({ paid: true, pay_method: "card" })
    .in("id", settleIds)
    .select("id, total, session_id, restaurant_id");

  await recordPayments(
    (settled ?? []).map(o => ({
      restaurantId: o.restaurant_id as string,
      orderId: o.id as string,
      sessionId: o.session_id as string | null,
      amount: Number(o.total),
      method: "card" as const,
      stripePaymentIntent:
        typeof session.payment_intent === "string" ? session.payment_intent : null,
    })),
  );

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
}

/**
 * A single order paid at the moment it was placed.
 */
async function settleOrder(session: Stripe.Checkout.Session): Promise<void> {
  const orderId = session.metadata!.order_id!;

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

  // A pay-now order can be the only thing the table owed.
  const { data: justPaid } = await supabase
    .from("orders")
    .select("session_id, total, restaurant_id")
    .eq("id", orderId)
    .maybeSingle();

  if (justPaid) {
    await recordPayment({
      restaurantId: justPaid.restaurant_id as string,
      orderId,
      sessionId: justPaid.session_id as string | null,
      amount: Number(justPaid.total),
      method: "card",
      stripePaymentIntent:
        typeof session.payment_intent === "string" ? session.payment_intent : null,
    });
  }
  await closeSessionsFor(justPaid ? [justPaid] : [], "paid");

  // The coupon use was reserved at checkout; the payment makes it real.
  await supabase
    .from("coupon_redemptions")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .is("confirmed_at", null);
}

/**
 * A checkout that was opened and never paid.
 *
 * Gives back the coupon use so a limited code is not burned by an abandoned
 * cart, and clears the order that will never be paid for.
 */
export async function abandonCheckout(session: Stripe.Checkout.Session): Promise<void> {
  // A bill that was never paid: the orders are real food already eaten, so
  // only the coupon reservation goes back — the rows stay on the table.
  const settled = (session.metadata?.settle_order_ids ?? "").split(",")[0]?.trim();
  if (settled) {
    await releaseReservation(settled);
    return;
  }

  const orderId = session.metadata?.order_id;
  if (orderId) await releaseAbandonedOrder(orderId);
}

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

  // Read the lines before the row goes, because the stock they reserved is
  // worked out from them. Deleting first would lose the only record of what
  // this checkout was holding, and the food would stay sold to nobody.
  const { data: abandoned } = await supabase
    .from("orders")
    .select("restaurant_id, items")
    .eq("id", orderId)
    .eq("status", "pending_payment")
    .eq("paid", false)
    .maybeSingle();

  // Only ever remove an order that was never paid for.
  const { error } = await supabase
    .from("orders")
    .delete()
    .eq("id", orderId)
    .eq("status", "pending_payment")
    .eq("paid", false);

  // Only after the row is really gone: releasing first and then failing to
  // delete would hand the same stock back twice if this ran again.
  if (!error && abandoned) {
    await releaseStock(
      abandoned.restaurant_id as string,
      (abandoned.items ?? []) as OrderLineItem[],
    );
  }
}
