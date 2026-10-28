import { createAdminClient } from "@/lib/supabase/admin";
import type { Order } from "@/lib/types";

/** What a staff discount came to. */
export type DiscountOutcome = "applied" | "part_paid" | "changed" | "failed";

/**
 * Reserves the use and writes it across the bill.
 *
 * The reservation goes first: a code with one use left must not come off two
 * tables at once. Recorded as confirmed straight away, unlike a checkout —
 * there is no payment page to abandon, the discount is real the moment the
 * manager grants it.
 *
 * All of it happens in `apply_bill_discount`, under the money lock: the coupon
 * use, the new totals and the redemption land together or not at all, and a
 * bill with money already collected is refused (paths audit #2). It used to be
 * written order by order from here, with failed writes ignored and the
 * redemption logged regardless. A charge can still move an order off the
 * table after the discount was read; the function re-reads it under the lock.
 */
export async function applyToOrders(
  orders: Order[],
  couponId: string,
  amount: number,
  restaurantId: string,
): Promise<DiscountOutcome> {
  const { data, error } = await createAdminClient().rpc("apply_bill_discount", {
    p_restaurant: restaurantId,
    p_orders: orders.map(o => o.id),
    p_coupon: couponId,
    p_amount: amount,
  });
  if (error) return "failed";
  return data === "applied" || data === "part_paid" ? data : "changed";
}
