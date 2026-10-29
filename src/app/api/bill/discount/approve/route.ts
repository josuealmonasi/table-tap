import { checkoutPageRpc } from "@/lib/checkout-page-rpc";
import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { actingManager } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { findCoupon } from "@/lib/coupon-service";
import { billTotal, discountableOrders } from "@/lib/staff-discount";
import type { Order } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/bill/discount/approve — a manager decides on a waiter's request.
 *
 * The amount is recomputed here rather than trusted from the row: the table
 * may have ordered more since the ask, and the discount has to match the bill
 * being paid, not the one that existed when someone walked to the till. And it
 * must match what the manager saw: the transaction checks it again under the
 * orders' locks, so approving an old ask cannot silently discount a different
 * bill.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const body = await jsonBody<{
    requestId?: string;
    approve?: boolean;
    reviewedAmount?: number;
  }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { requestId, approve, reviewedAmount } = body;
  if (!requestId) return await apiError("apiErr.invalidRequest", 400);

  if (typeof approve !== "boolean" || (approve &&
    (typeof reviewedAmount !== "number" || !Number.isFinite(reviewedAmount) || reviewedAmount <= 0))) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  const db = createAdminClient();
  const { data: request } = await db
    .from("discount_requests")
    .select("id, order_ids, code, status, amount")
    .eq("id", requestId)
    .eq("restaurant_id", actor.restaurantId)
    .eq("status", "pending")
    .maybeSingle();
  if (!request) return await apiError("apiErr.requestGone", 409);

  const decide = async (status: "rejected") =>
    await db
      .from("discount_requests")
      .update({
        status,
        decided_by: actor.email,
        decided_at: new Date().toISOString(),
      })
      .eq("id", request.id)
      .eq("status", "pending");

  if (!approve) {
    await decide("rejected");
    await logEvent({
      restaurantId: actor.restaurantId,
      actor: actor.email,
      entity: "discount",
      action: "rejected",
      detail: logDetail({ code: request.code }),
    });
    return NextResponse.json({ ok: true, approved: false });
  }

  if (Number(request.amount) !== reviewedAmount) return await apiError("apiErr.approvalChanged", 409);

  const { data: rows, error: readError } = await db
    .from("orders")
    .select("id, total, paid, written_off, status, coupon_code, discount")
    .is("account_id", null)
    .eq("restaurant_id", actor.restaurantId)
    .in("id", request.order_ids);

  if (readError) return await apiError("apiErr.verifyOrders", 503);
  const orders = discountableOrders((rows ?? []) as Order[]);
  if (orders.length === 0) {
    await decide("rejected");
    return await apiError("apiErr.nothingToDiscount", 409);
  }

  // A failed lookup is not "no such code" (findCoupon throws): the code may be
  // perfectly good, so it is kept and the person is asked to try again.
  const coupon = await findCoupon(actor.restaurantId, request.code).catch(() => undefined);
  if (coupon === undefined) return await apiError("apiErr.couponLookupFailed", 503);
  if (!coupon) return await apiError("apiErr.couponNotFound", 400);

  const { applyCoupon } = await import("@/lib/pricing");
  const { toAppliedCoupon, couponProblem } = await import("@/lib/coupon-service");
  const food = billTotal(orders);
  if (couponProblem(coupon, food)) return await apiError("apiErr.couponNotValid", 400);

  const amount = applyCoupon(toAppliedCoupon(coupon), food);
  if (amount !== reviewedAmount || orders.length !== request.order_ids.length) {
    return await apiError("apiErr.approvalChanged", 409);
  }
  // Rechecked under the order and request locks: pricing may have changed since this read.
  const { data: outcome, error } = await checkoutPageRpc("approve_discount_request_v2", {
    p_request: request.id, p_restaurant: actor.restaurantId,
    p_actor: actor.email, p_amount: reviewedAmount,
  }, { orderIds: request.order_ids });
  if (error) return await apiError("apiErr.generic", 500);
  // Paid in part since it was asked for (paths audit #2).
  if (outcome === "paying") return await apiError("apiErr.accountBillPaying", 409);
  if (outcome === "part_paid") return await apiError("apiErr.discountPartPaidLater", 409);
  if (outcome === "split") return await apiError("apiErr.billSplitLive", 409);
  if (outcome !== "approved") return await apiError("apiErr.approvalChanged", 409);

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "discount",
    action: "approved",
    orderIds: orders.map(o => o.id),
    detail: logDetail({ code: coupon.code, amount: amount.toFixed(2) }),
  });
  return NextResponse.json({ ok: true, approved: true, amount });
}
