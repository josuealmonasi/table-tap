import { createAdminClient } from "@/lib/supabase/admin";
import { everyRowIn } from "@/lib/paged";
import { dinerCurrency } from "@/lib/diner-currency";

/** Approval amounts belong to their saved orders, including after a menu change. */
export async function billRequestCurrencies(restaurantId: string, requests: { id: string; order_ids: string[] }[]) {
  const ids = requests.flatMap(r => r.order_ids ?? []);
  const db = createAdminClient();
  const orders = await everyRowIn<{ id: string; currency: string }>(ids, (slice, a, b) => db.from("orders")
    .select("id,currency").eq("restaurant_id",restaurantId).in("id",slice).order("id").range(a,b), "the requested bills' currencies");
  const byId = new Map(orders.map(o => [o.id,o]));
  return new Map(requests.map(r => {
    const own = (r.order_ids ?? []).flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
    return [r.id, own.length === r.order_ids?.length ? dinerCurrency(own) : null];
  }));
}
