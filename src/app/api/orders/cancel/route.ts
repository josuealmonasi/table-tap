import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// POST /api/orders/cancel  — cancel an order, refunding it first if it was
// paid. Owner-only. This is the ONLY path that may set status "cancelled",
// so an order can never be cancelled without its refund.
export async function POST(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Refunds move money, so only the owner or a manager may cancel. The RLS
  // read proves membership; the role check separates them from kitchen.
  const { data: visible } = await supabase
    .from("orders")
    .select("id, restaurants(owner_id)")
    .eq("id", id)
    .single();
  const rel = (visible as { restaurants?: { owner_id?: string } | { owner_id?: string }[] } | null)
    ?.restaurants;
  const ownerId = Array.isArray(rel) ? rel[0]?.owner_id : rel?.owner_id;
  if (!visible) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (ownerId !== user.id) {
    const { data: me } = await supabase
      .from("staff")
      .select("role")
      .eq("user_id", user.id)
      .single();
    if (me?.role !== "manager") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Re-read the authoritative row: guards double-clicks and two tabs racing.
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, status, paid, stripe_payment_intent, stripe_refund_id")
    .eq("id", id)
    .single();
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  if (order.status !== "received" && order.status !== "preparing") {
    return NextResponse.json(
      { error: "Only new or preparing orders can be cancelled." },
      { status: 409 }
    );
  }

  // Paid orders must be refunded before they can be cancelled.
  let refundId: string | null = order.stripe_refund_id;
  if (order.paid && !refundId) {
    if (!order.stripe_payment_intent) {
      // Paid but the webhook hasn't recorded the payment yet — don't cancel
      // silently without a refund.
      return NextResponse.json(
        { error: "Payment is still settling — try again in a moment." },
        { status: 409 }
      );
    }
    try {
      // The idempotency key makes a double-submit return the same refund
      // instead of failing on an already-refunded payment.
      const refund = await stripe.refunds.create(
        { payment_intent: order.stripe_payment_intent },
        { idempotencyKey: `cancel-${order.id}` }
      );
      refundId = refund.id;
    } catch (err) {
      console.error("refund error", err);
      return NextResponse.json(
        { error: "Refund failed — the order was NOT cancelled. Try again." },
        { status: 500 }
      );
    }
  }

  const { error } = await admin
    .from("orders")
    .update({ status: "cancelled", stripe_refund_id: refundId })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
