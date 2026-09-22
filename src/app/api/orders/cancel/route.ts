import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { actingManager } from "@/lib/api-guard";
import { releaseStock } from "@/lib/stock-service";
import { summarise } from "@/lib/cancel-plan";
import { readCancel } from "@/lib/cancel-read";

export const runtime = "nodejs";

// GET /api/orders/cancel?id=…  — what cancelling this order would give back,
// and who would have to give it. The dialog words its offer from this, so it
// cannot promise a refund the POST below will not make: it used to promise one
// for every paid card order, and the POST could refund only those whose
// payment intent sat on the order itself.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return await apiError("apiErr.invalidRequest", 400);

  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const read = await readCancel(createAdminClient(), actor.restaurantId, id);
  if ("error" in read) return await apiError(read.error, read.status);
  return NextResponse.json(summarise(read.order, read.plan));
}

// POST /api/orders/cancel  — cancel an order, refunding it first if it was
// paid online. Owner or manager. This is the ONLY path that may set status
// "cancelled", so an order paid through Stripe is never cancelled unrefunded.
export async function POST(req: NextRequest) {
  const body = await jsonBody<Record<string, unknown>>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { id } = body;
  if (!id || typeof id !== "string") return await apiError("apiErr.invalidRequest", 400);

  // Refunds move money, so only the owner or a manager may cancel.
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  // Re-read the authoritative row: guards double-clicks and two tabs racing.
  const admin = createAdminClient();
  const read = await readCancel(admin, actor.restaurantId, id);
  if ("error" in read) return await apiError(read.error, read.status);
  const { order, plan } = read;

  // Money back through Stripe before anything else, so a refund that fails
  // leaves the order standing. One refund per payment, for that payment's own
  // amount: one order of a table's bill gets back its share of the charge, not
  // the whole charge. Keyed by payment intent, so a retry — or the loser of a
  // double click — is handed the same refund rather than a second one.
  //
  // Everything else is money a person gives back — cash from a drawer, a void
  // on the restaurant's own terminal, a share of a table's bill. The app can
  // move none of it, so it writes it down and the dialog has already said so.
  let refundId: string | null = order.stripe_refund_id;
  if (plan.refunds.length > 0 && !refundId) {
    // Direct charges live on the restaurant's own Stripe account, so the
    // refund has to be asked for there.
    const { data: acct } = await admin
      .from("restaurants")
      .select("stripe_account_id")
      .eq("id", actor.restaurantId)
      .single();
    if (!acct?.stripe_account_id) return await apiError("apiErr.refundFailed", 500);

    try {
      for (const r of plan.refunds) {
        const refund = await stripe.refunds.create(
          {
            payment_intent: r.paymentIntent,
            amount: Math.round(r.amount * 100),
            // Our cut goes back too, in proportion. The diner did not get the
            // food, so keeping a fee for it would charge the restaurant for a
            // sale that never happened.
            refund_application_fee: true,
          },
          {
            idempotencyKey: `cancel-${order.id}-${r.paymentIntent}`,
            stripeAccount: acct.stripe_account_id,
          },
        );
        refundId ??= refund.id;
      }
    } catch (err) {
      console.error("refund error", err);
      return await apiError("apiErr.refundFailed", 502);
    }
  }

  // Conditional on the status read above, so of two cancels racing only one
  // moves the order. The other would write a second handback, and the corte
  // would take the sale out of the drawer twice.
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
  await releaseStock(actor.restaurantId, order.items ?? []);

  const code = id.slice(0, 8);
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

  // One line per amount given back, naming who TOOK it: the corte takes it out
  // of that person's line, or off the online total when nobody did. The
  // payments rows stay — the money really arrived, and `payments.amount` must
  // be above zero — so the log is where a handback is written down.
  const givenBack = [
    ...plan.refunds.map(r => ({ amount: r.amount, method: "card", collector: r.collector })),
    ...plan.handBack,
  ];
  for (const back of givenBack) {
    await logEvent({
      restaurantId: actor.restaurantId,
      actor: actor.email,
      entity: "order",
      action: "refunded",
      detail: logDetail({
        order: code,
        amount: back.amount.toFixed(2),
        method: back.method,
        collector: back.collector,
      }),
    });
  }
  return NextResponse.json({ ok: true });
}
