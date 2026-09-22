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
    .select("id, status, paid, pay_method, total, stripe_payment_intent, stripe_refund_id, items")
    .eq("id", id)
    .eq("restaurant_id", actor.restaurantId)
    .maybeSingle();
  if (!order) return await apiError("apiErr.orderNotFound", 404);

  if (order.status !== "received" && order.status !== "preparing") {
    return await apiError("apiErr.cancelStatus", 409);
  }

  // Who took the money, read before anything changes. The handback below is
  // written against them, and a cancel that could not say whose drawer it
  // leaves would go through and count that person short.
  let taken: { amount: number; method: string | null; actor_email: string | null }[] = [];
  if (order.paid) {
    const { data, error: readErr } = await admin
      .from("payments")
      .select("amount, method, actor_email")
      .eq("restaurant_id", actor.restaurantId)
      .eq("order_id", id);
    if (readErr) {
      console.error("cancel: payments read failed:", readErr.message);
      return await apiError("apiErr.orderCancel", 500);
    }
    taken = data ?? [];
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

  // Conditional on the status read above, so of two cancels racing — a double
  // click, two tabs — only one moves the order. The other would otherwise
  // write a second handback, and the corte would take the sale out of the
  // drawer twice. The refund itself is safe either way: Stripe answers the
  // second ask with the first refund, by the idempotency key.
  const { data: moved, error } = await admin
    .from("orders")
    .update({ status: "cancelled", stripe_refund_id: refundId })
    .eq("id", id)
    .eq("restaurant_id", actor.restaurantId)
    .in("status", ["received", "preparing"])
    .select("id");
  if (error) {
    console.error("cancel failed:", error.message);
    return await apiError("apiErr.orderCancel", 500);
  }
  if (!moved?.length) return await apiError("apiErr.cancelStatus", 409);

  // The food was never served, so put it back on the shelf. After the status
  // write, not before: a cancel that failed halfway would otherwise return
  // stock for an order still standing.
  await releaseStock(actor.restaurantId, (order.items ?? []) as OrderLineItem[]);

  const code = String(id).slice(0, 8);
  if (!order.paid) {
    await logEvent({
      restaurantId: actor.restaurantId,
      actor: actor.email,
      entity: "order",
      action: "cancelled",
      detail: logDetail({ order: code }),
    });
    return NextResponse.json({ ok: true });
  }

  // What this cancel handed back, one line per payment it reverses, each
  // naming the person who TOOK the money. That is whose drawer it leaves: the
  // corte takes it out of their line, and without this a waiter who handed a
  // cancelled cash sale back was counted short by exactly its amount. The
  // line used to say only `order=…`, so the corte could not read it at all.
  //
  // The payments row itself stays. It records money that really arrived, and
  // `payments.amount` has to be above zero, so a handback is written down here
  // — the same place the corte already reads write-offs and discounts from.
  // An order paid only through its sitting — a table settled in parts — has
  // no payment of its own to name, so its money cannot be taken out of one
  // particular drawer. It is still written down, with its total, and counted
  // in the corte's "handed back" line. `pay_method` also says apple, google or
  // paypal, which the corte cannot place in a column and would skip, so it is
  // folded the way the ledger folds it: cash is cash, everything else a card.
  const reversed =
    taken.length > 0
      ? taken
      : [{
          amount: order.total,
          method: order.pay_method === "cash" ? "cash" : "card",
          actor_email: null,
        }];

  for (const payment of reversed) {
    await logEvent({
      restaurantId: actor.restaurantId,
      actor: actor.email,
      entity: "order",
      action: "refunded",
      detail: logDetail({
        order: code,
        amount: Number(payment.amount).toFixed(2),
        method: payment.method,
        collector: payment.actor_email,
      }),
    });
  }
  return NextResponse.json({ ok: true });
}
