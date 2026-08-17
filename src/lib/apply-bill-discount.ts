import { createAdminClient } from "@/lib/supabase/admin";
import { claimCoupon, logRedemption } from "@/lib/coupon-service";
import { spreadDiscount } from "@/lib/staff-discount";
import type { Order } from "@/lib/types";

/**
 * Reserves the use and writes it across the bill.
 *
 * The reservation goes first: a code with one use left must not come off two
 * tables at once. Recorded as confirmed straight away, unlike a checkout —
 * there is no payment page to abandon, the discount is real the moment the
 * manager grants it.
 */
export async function applyToOrders(
  orders: Order[],
  couponId: string,
  code: string,
  amount: number,
  restaurantId: string,
): Promise<boolean> {
  if (!(await claimCoupon(couponId))) return false;

  const db = createAdminClient();
  for (const share of spreadDiscount(orders, amount)) {
    const order = orders.find(o => o.id === share.orderId)!;
    await db
      .from("orders")
      .update({
        coupon_code: code,
        discount: round2(Number(order.discount ?? 0) + share.amount),
        total: share.total,
      })
      .eq("id", share.orderId);
  }

  await logRedemption({
    restaurantId,
    couponId,
    orderId: orders[0].id,
    code,
    amount,
  });
  await db
    .from("coupon_redemptions")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("order_id", orders[0].id)
    .is("confirmed_at", null);

  return true;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
