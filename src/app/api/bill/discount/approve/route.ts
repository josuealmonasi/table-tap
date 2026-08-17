import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingManager } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { findCoupon } from "@/lib/coupon-service";
import { billTotal, discountableOrders } from "@/lib/staff-discount";
import { applyToOrders } from "@/lib/apply-bill-discount";
import type { Order } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/bill/discount/approve — a manager decides on a waiter's request.
 *
 * The amount is recomputed here rather than trusted from the row: the table
 * may have ordered more since the ask, and the discount has to match the bill
 * being paid, not the one that existed when someone walked to the till.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const { requestId, approve } = (await req.json()) as {
    requestId?: string;
    approve?: boolean;
  };
  if (!requestId) return await apiError("apiErr.invalidRequest", 400);

  const db = createAdminClient();
  const { data: request } = await db
    .from("discount_requests")
    .select("id, order_ids, code, status")
    .eq("id", requestId)
    .eq("restaurant_id", actor.restaurantId)
    .eq("status", "pending")
    .maybeSingle();
  if (!request) return await apiError("apiErr.requestGone", 409);

  const decide = async (status: "approved" | "rejected", amount?: number) =>
    await db
      .from("discount_requests")
      .update({
        status,
        decided_by: actor.email,
        decided_at: new Date().toISOString(),
        ...(amount === undefined ? {} : { amount }),
      })
      .eq("id", request.id);

  if (!approve) {
    await decide("rejected");
    return NextResponse.json({ ok: true, approved: false });
  }

  const { data: rows } = await db
    .from("orders")
    .select("id, total, paid, written_off, status, coupon_code, discount")
    .eq("restaurant_id", actor.restaurantId)
    .in("id", request.order_ids);

  const orders = discountableOrders((rows ?? []) as Order[]);
  if (orders.length === 0) {
    await decide("rejected");
    return await apiError("apiErr.nothingToDiscount", 409);
  }

  const coupon = await findCoupon(actor.restaurantId, request.code);
  if (!coupon) return await apiError("apiErr.couponNotFound", 400);

  const { applyCoupon } = await import("@/lib/pricing");
  const { toAppliedCoupon, couponProblem } = await import("@/lib/coupon-service");
  const food = billTotal(orders);
  if (couponProblem(coupon, food)) return await apiError("apiErr.couponNotValid", 400);

  const amount = applyCoupon(toAppliedCoupon(coupon), food);
  const applied = await applyToOrders(orders, coupon.id, coupon.code, amount, actor.restaurantId);
  if (!applied) return await apiError("apiErr.couponNotValid", 409);

  await decide("approved", amount);
  return NextResponse.json({ ok: true, approved: true, amount });
}
