import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { planBlocks } from "@/lib/plan-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { couponProblem, findCoupon, toAppliedCoupon } from "@/lib/coupon-service";
import { applyCoupon } from "@/lib/pricing";
import { billTotal, discountableOrders } from "@/lib/staff-discount";
import { applyToOrders } from "@/lib/apply-bill-discount";
import type { Order } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/bill/discount — the floor applies a promotion to an open bill.
 *
 * Some promotions have no code for the diner: "half price if you show your
 * membership" is settled at the table by someone looking at the card. The
 * manager opens the bill, enters the restaurant's own code, and the amount the
 * customer is asked for drops before they pay.
 *
 * A waiter may ask but not grant — the row they leave behind is a request, and
 * approving it is what moves the money. That keeps the decision with whoever
 * carries the responsibility for it, without making the waiter fetch someone
 * before they can even start.
 *
 * Only unpaid orders: money that has already moved needs a refund, which is a
 * different act with its own record, and the manager already has it.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const blocked = await planBlocks(actor.restaurantId, "staffDiscounts");
  if (blocked) return blocked;

  const { tableId, orderId, code } = (await req.json()) as {
    tableId?: string;
    orderId?: string;
    code?: string;
  };
  if ((!tableId && !orderId) || typeof code !== "string" || !code.trim()) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const db = createAdminClient();

  // Scoped to the actor's own restaurant, so an id from elsewhere finds nothing.
  let query = db
    .from("orders")
    .select("id, total, paid, written_off, status, coupon_code, table_id, table_label")
    .eq("restaurant_id", actor.restaurantId);
  query = orderId ? query.eq("id", orderId) : query.eq("table_id", tableId!);

  const { data: rows } = await query;
  const orders = discountableOrders((rows ?? []) as Order[]);
  if (orders.length === 0) return await apiError("apiErr.nothingToDiscount", 409);

  const food = billTotal(orders);
  const coupon = await findCoupon(actor.restaurantId, code);
  if (!coupon) return await apiError("apiErr.couponNotFound", 400);
  if (couponProblem(coupon, food)) return await apiError("apiErr.couponNotValid", 400);

  const amount = applyCoupon(toAppliedCoupon(coupon), food);
  if (amount <= 0) return await apiError("apiErr.couponNotValid", 400);

  // A waiter's ask is recorded and stops there.
  if (actor.role === "waiter") {
    const { error } = await db.from("discount_requests").insert({
      restaurant_id: actor.restaurantId,
      table_id: orders[0].table_id,
      table_label: orders[0].table_label,
      order_ids: orders.map(o => o.id),
      code: coupon.code,
      amount,
      requested_by: actor.email,
    });
    if (error) return await apiError("apiErr.generic", 500);
    await logEvent({
      restaurantId: actor.restaurantId,
      actor: actor.email,
      entity: "discount",
      action: "requested",
      detail: logDetail({ code: coupon.code, amount: amount.toFixed(2), table: orders[0].table_label }),
    });
    return NextResponse.json({ pending: true, amount, code: coupon.code });
  }

  const applied = await applyToOrders(orders, coupon.id, coupon.code, amount, actor.restaurantId);
  if (!applied) return await apiError("apiErr.couponNotValid", 409);

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "discount",
    action: "discounted",
    detail: logDetail({ code: coupon.code, amount: amount.toFixed(2), table: orders[0].table_label }),
  });
  return NextResponse.json({ ok: true, amount, code: coupon.code });
}
