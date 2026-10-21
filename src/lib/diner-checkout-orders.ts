import { createAdminClient } from "@/lib/supabase/admin";
import { everyRowIn } from "@/lib/paged";

interface CheckoutOrder { id: string; restaurant_id: string; currency: string; total: number; tip: number }

/** Account statements can outgrow one response or URL; no part of their scope may disappear. */
export async function dinerCheckoutOrders(ids: string[]): Promise<CheckoutOrder[]> {
  return everyRowIn<CheckoutOrder>(ids, (slice, from, to) => createAdminClient().from("orders")
    .select("id, restaurant_id, currency, total, tip").in("id", slice).order("id").range(from, to), "checkout orders");
}
