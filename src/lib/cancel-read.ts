// ============================================================================
// The order a cancel is about, and what cancelling it would give back.
//
// Read the same way for the dialog that asks first and for the cancel itself,
// so the two cannot disagree about what the money does.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelPlan, type CancelPayment, type CancelPlan } from "@/lib/cancel-plan";
import type { OrderLineItem } from "@/lib/types";

export interface CancelTarget {
  id: string;
  status: string;
  paid: boolean;
  pay_method: string | null;
  total: number;
  stripe_payment_intent: string | null;
  stripe_refund_id: string | null;
  items: OrderLineItem[] | null;
}

export type CancelRead =
  | { order: CancelTarget; plan: CancelPlan }
  | { error: string; status: number };

export async function readCancel(
  admin: SupabaseClient,
  restaurantId: string,
  id: string,
): Promise<CancelRead> {
  // Scoped to the caller's restaurant, so another tenant's order id is simply
  // not found. The write that follows is scoped the same way, on a path that
  // moves money.
  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select("id, status, paid, pay_method, total, stripe_payment_intent, stripe_refund_id, items")
    .eq("id", id)
    .eq("restaurant_id", restaurantId)
    .maybeSingle<CancelTarget>();
  if (orderErr) {
    console.error("cancel: order read failed:", orderErr.message);
    return { error: "apiErr.orderCancel", status: 500 };
  }
  if (!order) return { error: "apiErr.orderNotFound", status: 404 };

  if (order.status !== "received" && order.status !== "preparing") {
    return { error: "apiErr.cancelStatus", status: 409 };
  }

  // How the money arrived, payment by payment. A read that fails refuses the
  // cancel: going ahead without it would refund nothing and name no drawer.
  let payments: CancelPayment[] = [];
  if (order.paid) {
    const { data, error } = await admin
      .from("payments")
      .select("amount, method, actor_email, stripe_payment_intent")
      .eq("restaurant_id", restaurantId)
      .eq("order_id", id);
    if (error) {
      console.error("cancel: payments read failed:", error.message);
      return { error: "apiErr.orderCancel", status: 500 };
    }
    payments = data ?? [];
  }

  return { order, plan: cancelPlan(order, payments) };
}
