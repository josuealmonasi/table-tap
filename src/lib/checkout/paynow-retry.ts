import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { readCardSession } from "@/lib/checkout/card-session";

interface PayNowRetry {
  restaurantId: string;
  ref: string;
  scope: string;
  stripeAccount: string | null;
}

/** Resume before taking stock or a coupon: the first order already owns them. */
export async function resumePayNowCheckout(p: PayNowRetry): Promise<NextResponse | null> {
  const { data: order, error } = await createAdminClient().from("orders")
    .select("id, request_scope, status, stripe_session_id, session_id")
    .eq("restaurant_id", p.restaurantId).eq("request_ref", p.ref).maybeSingle();
  if (error) throw new Error(`Could not read checkout retry: ${error.message}`);
  if (!order) return null;
  if (order.request_scope !== p.scope || order.status !== "pending_payment" || !p.stripeAccount) {
    return await apiError("apiErr.retryConflict", 409);
  }
  // The winner may still be opening Stripe. Taking another reservation here
  // would sell the same meal twice while its first page is on the way.
  if (!order.stripe_session_id) return await apiError("apiErr.checkoutOpening", 409);
  const session = await readCardSession(order.stripe_session_id, p.stripeAccount);
  // Expiry deletes the unpaid order and frees its reference. Until that has
  // happened, a new page could race the return of its stock and coupon.
  if (session.status !== "open") return await apiError("apiErr.retryConflict", 409);
  return NextResponse.json({ url: session.url, orderId: order.id, sessionId: order.session_id });
}
