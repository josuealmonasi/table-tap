import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { actingManager } from "@/lib/api-guard";
import { releaseStock } from "@/lib/stock-service";
import type { OrderLineItem } from "@/lib/types";

export const runtime = "nodejs";

// POST /api/orders/cancel  — cancel an order, refunding it first if it was
// paid. Owner-only. This is the ONLY path that may set status "cancelled",
// so an order can never be cancelled without its refund.
export async function POST(req: NextRequest) {
  const body = await jsonBody<Record<string, unknown>>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { id } = body;
  if (!id) return await apiError("apiErr.invalidRequest", 400);

  // Refunds move money, so only the owner or a manager may cancel.
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  // Re-read the authoritative row: guards double-clicks and two tabs racing.
  // Scoped to the caller's restaurant, so another tenant's order id simply
  // isn't found. This used to lean on the RLS visibility of an earlier read
  // to prove tenancy, which was sound but left the write itself scoped by id
  // alone — the boundary is worth stating outright on a path that refunds.
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, status, paid, pay_method, stripe_payment_intent, stripe_refund_id, items")
    .eq("id", id)
    .eq("restaurant_id", actor.restaurantId)
    .maybeSingle();
  if (!order) return await apiError("apiErr.orderNotFound", 404);

  if (order.status !== "received" && order.status !== "preparing") {
    return await apiError("apiErr.cancelStatus", 409);
  }

  // Paid orders must be refunded before they can be cancelled.
  let refundId: string | null = order.stripe_refund_id;
  // Cash is not a card that has not settled yet, and treating it as one made a
  // cash sale impossible to cancel: no payment intent ever arrives, so the
  // owner was told "payment is still settling — try again" for ever, on an
  // order the board would go on showing. The screen meanwhile offered to
  // refund the amount, which is the app's own worst habit — promising what it
  // then refuses.
  //
  // Nothing has to be reversed here. The money genuinely arrived and the
  // payment row stays, which is a state the ledger already expects: its check
  // for money against an unsettled order excludes cancelled ones on purpose.
  // What the app cannot do is take notes out of the drawer, so it says so and
  // leaves that to the person standing at the till.
  const paidInCash = order.pay_method === "cash";
  if (order.paid && !refundId && !paidInCash) {
    if (!order.stripe_payment_intent) {
      // A card whose webhook has not landed yet — genuinely a moment away, and
      // retrying genuinely helps. Don't cancel silently without a refund.
      return await apiError("apiErr.settling", 409);
    }
    // The payment lives on the restaurant's own Stripe account — both ways of
    // paying are direct charges — so the refund has to be asked for there.
    // Without the account, Stripe answers "no such payment_intent" and an
    // owner cannot cancel an order somebody already paid for.
    const { data: acct } = await admin
      .from("restaurants")
      .select("stripe_account_id")
      .eq("id", actor.restaurantId)
      .single();
    if (!acct?.stripe_account_id) return await apiError("apiErr.refundFailed", 500);

    try {
      // The idempotency key makes a double-submit return the same refund
      // instead of failing on an already-refunded payment.
      const refund = await stripe.refunds.create(
        {
          payment_intent: order.stripe_payment_intent,
          // Our cut goes back too. The diner did not get the food, so keeping
          // a fee for it would be charging the restaurant for a sale that
          // never happened.
          refund_application_fee: true,
        },
        {
          idempotencyKey: `cancel-${order.id}`,
          stripeAccount: acct.stripe_account_id,
        },
      );
      refundId = refund.id;
    } catch (err) {
      console.error("refund error", err);
      return await apiError("apiErr.refundFailed", 500);
    }
  }

  const { error } = await admin
    .from("orders")
    .update({ status: "cancelled", stripe_refund_id: refundId })
    .eq("id", id)
    .eq("restaurant_id", actor.restaurantId);
  if (error) {
    console.error("cancel failed:", error.message);
    return await apiError("apiErr.orderCancel", 500);
  }

  // The food was never served, so put it back on the shelf. After the status
  // write, not before: a cancel that failed halfway would otherwise return
  // stock for an order still standing.
  await releaseStock(actor.restaurantId, (order.items ?? []) as OrderLineItem[]);

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "order",
    action: refundId ? "refunded" : "cancelled",
    detail: logDetail({ order: String(id).slice(0, 8) }),
  });
  return NextResponse.json({ ok: true });
}
