/** Orphaned reservations are an interrupted sale whose stock still needs returning. */
export async function checkStockReturns(db, { ok, bad }) {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await db.from("stock_reservations")
    .select("id, restaurant_id, created_at, orders(id)")
    .is("released_at", null).lt("created_at", cutoff).is("orders", null)
    .limit(100);
  if (error) return bad(`cannot audit stock returns: ${error.message}`);
  if (!data.length) ok("no orphan stock reservation awaits recovery");
  for (const row of data) bad(`stock reservation ${row.id} has no order since ${row.created_at}; run db:recover-stock for this environment`);
  const { data: stalled, error: stalledError } = await db.from("stock_reservations")
    .select("id, orders!inner(id, stripe_session_id)")
    .is("released_at", null).lt("created_at", cutoff)
    .eq("orders.status", "pending_payment").eq("orders.paid", false).limit(100);
  if (stalledError) return bad(`cannot audit stalled checkouts: ${stalledError.message}`);
  if (!stalled.length) ok("no stock reservation is held by a stalled checkout");
  for (const row of stalled) bad(`stock reservation ${row.id} still belongs to an old pending checkout; verify its Stripe payment and retry checkout expiry before returning stock`);
}
