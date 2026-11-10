import { runBatch, type PendingItem, type RecoveryContext } from "./job";

export async function recoverStock(context: RecoveryContext) {
  const { db } = context;
  const cutoff = new Date(Date.now() - 3600_000).toISOString();
  return runBatch("stock", context, limit => db.from("stock_reservations")
    .select("restaurant_id, created_at, orders(id)", { count: "exact" })
    .is("released_at", null).lt("created_at", cutoff).is("orders", null)
    .order("created_at").order("id").limit(limit).returns<PendingItem[]>(), async () => {
    // SQL chooses and locks one orphan across all restaurants. The observed
    // row is never released directly: an order may have bound it since then.
    const { data, error } = await db.rpc("recover_stock_reservations", {});
    if (error || !Number.isSafeInteger(data) || data < 0 || data > 1) throw new Error(error?.message ?? "Invalid stock recovery count");
    return data;
  });
}
