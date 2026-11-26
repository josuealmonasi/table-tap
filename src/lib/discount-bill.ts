import type { createAdminClient } from "@/lib/supabase/admin";
import { discountableOrders } from "@/lib/staff-discount";
import type { Order } from "@/lib/types";

/** Which bill the floor means: a table in one currency, or one counter order. */
export interface DiscountBillScope {
  tableId?: string | null;
  orderId?: string | null;
  currency?: string | null;
}

/**
 * The orders a staff discount would touch, read the one way both the apply
 * route and the list of options read them — so a code offered for a bill is
 * judged on exactly the orders, and the base, the apply route will use.
 *
 * Scoped to the actor's restaurant, so an id from elsewhere finds nothing.
 * `null` means the read failed, which is not an empty bill.
 */
export async function readDiscountableBill(
  db: ReturnType<typeof createAdminClient>,
  restaurantId: string,
  scope: DiscountBillScope,
): Promise<Order[] | null> {
  let query = db
    .from("orders")
    .select("id, total, tip, service_fee, paid, written_off, status, coupon_code, table_id, table_label")
    .is("account_id", null)
    .eq("restaurant_id", restaurantId);
  query = scope.orderId ? query.eq("id", scope.orderId) : query.eq("table_id", scope.tableId!);
  if (scope.currency) query = query.eq("currency", scope.currency);
  const { data, error } = await query;
  if (error) return null;
  return discountableOrders((data ?? []) as Order[]);
}
