import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { actingManager } from "@/lib/api-guard";

export const runtime = "nodejs";

// POST /api/orders/cancel  — cancel an order, refunding it first if it was
// paid. Owner-only. This is the ONLY path that may set status "cancelled",
// so an order can never be cancelled without its refund.
export async function POST(req: NextRequest) {
  const { id } = await req.json();
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
    .select("id, status, paid, stripe_payment_intent, stripe_refund_id")
    .eq("id", id)
    .eq("restaurant_id", actor.restaurantId)
    .maybeSingle();
  if (!order) return await apiError("apiErr.orderNotFound", 404);

  if (order.status !== "received" && order.status !== "preparing") {
    return await apiError("apiErr.cancelStatus", 409);
  }

  // Paid orders must be refunded before they can be cancelled.
  let refundId: string | null = order.stripe_refund_id;
  if (order.paid && !refundId) {
    if (!order.stripe_payment_intent) {
      // Paid but the webhook hasn't recorded the payment yet — don't cancel
      // silently without a refund.
      return await apiError("apiErr.settling", 409);
    }
    try {
      // The idempotency key makes a double-submit return the same refund
      // instead of failing on an already-refunded payment.
      const refund = await stripe.refunds.create(
        { payment_intent: order.stripe_payment_intent },
        { idempotencyKey: `cancel-${order.id}` },
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
