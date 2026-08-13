import { createAdminClient } from "@/lib/supabase/admin";
import { unpaidOrders } from "@/lib/table-bill";
import type { Order } from "@/lib/types";

/**
 * What a table still owes, read server-side.
 *
 * Customers cannot read `orders` at all — the policy that let them was removed
 * as over-permissive — so this goes through the secret key and hands back only
 * the fields a diner needs to recognise their food and settle for it. Same
 * shape as the order tracker, for the same reason.
 *
 * Anyone holding the table's URL can see what that table owes. The URL is
 * printed on the table, so this is the same trust boundary as the menu itself:
 * it tells you what the people sitting there ordered, which they can see
 * anyway.
 */

/** Only the columns the bill screen and the waiter's modal actually show. */
const FIELDS = "id, table_label, status, items, subtotal, service_fee, tip, total, currency, paid, created_at";

export async function fetchTableBill(
  restaurantId: string,
  tableId: string,
): Promise<Order[]> {
  const { data, error } = await createAdminClient()
    .from("orders")
    .select(FIELDS)
    // Both, always: the table id alone would let one restaurant's id be paired
    // with another's table.
    .eq("restaurant_id", restaurantId)
    .eq("table_id", tableId)
    .eq("paid", false)
    .neq("status", "pending_payment")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Could not load the table's bill: ${error.message}`);
  // `pending_payment` is already excluded above — those are carts mid-Stripe,
  // not debts. unpaidOrders drops cancelled ones.
  return unpaidOrders((data ?? []) as Order[]);
}
