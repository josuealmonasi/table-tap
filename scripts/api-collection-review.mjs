/** Read the balance the waiter reviews, including money already allocated. */
export async function collectionReview(f, tableId) {
  const { data: orders, error } = await f.admin.from("orders").select("id,total,currency")
    .eq("restaurant_id",f.restaurant.id).eq("table_id",tableId).eq("paid",false)
    .eq("written_off",false).is("account_id",null).not("status","in","(cancelled,pending_payment)");
  if (error) throw new Error(error.message);
  const { data: coverage, error: readError } = await f.admin.rpc("order_coverage", { p_restaurant: f.restaurant.id, p_orders: orders.map(o => o.id) });
  if (readError) throw new Error(readError.message);
  const paid = new Map((coverage ?? []).map(o => [o.id,Number(o.amount)]));
  return { expected: Math.round(orders.reduce((sum,o) => sum + Number(o.total) - (paid.get(o.id) ?? 0),0)*100)/100,
    currency: orders[0]?.currency ?? f.restaurant.currency };
}
