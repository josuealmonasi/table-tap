import { createAdminClient } from "@/lib/supabase/admin";
import { everyRowIn } from "@/lib/paged";
import { logDetail } from "@/lib/log-detail";

/** Stamp the orders' currency, never the menu's current currency. A mixed or
 * missing scope stays unverified rather than labelling its sum as one money.
 * Logging remains best effort: a failed read must not block the sale. */
export async function withOrderCurrency(detail: string | null | undefined, restaurantId: string, orderIds: string[]): Promise<string | null> {
  try {
    const db = createAdminClient();
    const orders = await everyRowIn<{ currency: string }>(orderIds, (ids, a, b) => db.from("orders")
      .select("currency").eq("restaurant_id", restaurantId).in("id", ids).order("id").range(a, b), "the activity's order currencies");
    const currencies = new Set(orders.map(o => o.currency));
    const currency = orders[0]?.currency;
    if (orders.length === new Set(orderIds).size && currencies.size === 1 && ["MXN", "USD"].includes(currency)) {
      return [detail, logDetail({ currency })].filter(Boolean).join(" ");
    }
  } catch (error) {
    console.error("activity log currency:", error);
  }
  return detail ?? null;
}
