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
  stock_managed?: boolean;
  /** On a customer account: owed by the account, paid when it is. */
  account_id?: string | null;
}

export type CancelRead =
  | { order: CancelTarget; plan: CancelPlan; hold: string | null; holdId: string | null }
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
    .select("id, status, paid, pay_method, total, stripe_payment_intent, stripe_refund_id, items, account_id, stock_managed")
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

  // On an account the customer is paying online right now: Stripe will charge
  // the orders the payment was opened for, this one among them, and a dish
  // cancelled in between would be paid for anyway. Wait for it to land or
  // run out — the hold is half an hour at most.
  let hold: string | null = null;
  let holdId: string | null = null;
  if (order.account_id) {
    const { data: account, error: accountErr } = await admin
      .from("customer_accounts")
      .select("checkout_until, checkout_id")
      .eq("id", order.account_id)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (accountErr) {
      console.error("cancel: account read failed:", accountErr.message);
      return { error: "apiErr.orderCancel", status: 500 };
    }
    hold = account?.checkout_until ?? null;
    holdId = account?.checkout_id ?? null;
    if (!order.paid && hold && new Date(hold) > new Date()) {
      return { error: "apiErr.accountPayingOnline", status: 409 };
    }
  }

  const { data: attribution, error: attributionError } = await admin.rpc("order_coverage", {
    p_restaurant: restaurantId, p_orders: [id],
  });
  if (attributionError) return { error: "apiErr.verifyOrders", status: 503 };
  if (attribution?.some((r: { unresolved?: boolean }) => r.unresolved)) return { error: "apiErr.attributionRequired", status: 409 };

  // Coverage exists even while a divided bill is only partly paid. Never
  // infer a pooled payment's provider or collector from an order flag.
  const { data: coverage, error: coverageError } = await admin.rpc("order_refund_coverage", {
    p_restaurant: restaurantId, p_order: id,
  });
  if (coverageError) return { error: "apiErr.verifyOrders", status: 503 };
  const payments: CancelPayment[] = (coverage ?? []).map((p: {
    amount: number; method: string; actor_email: string | null;
    stripe_payment_intent: string | null; stripe_account_id: string | null; allocation_quality: string;
  }) => ({
    amount: Number(p.amount), method: p.method, actor_email: p.actor_email,
    stripe_payment_intent: p.allocation_quality === "exact" && p.stripe_account_id ? p.stripe_payment_intent : null,
  }));
  const covered = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const plan = cancelPlan({ ...order, paid: payments.length > 0 }, payments);
  if (order.paid && Number(order.total) - covered > 0.005) {
    return { error: "apiErr.attributionRequired", status: 409 };
  }
  return { order, plan, hold, holdId };
}
