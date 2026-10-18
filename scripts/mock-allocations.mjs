/** Demonstrate a pending return using the same transaction as the product. */
export async function seedAllocations(pg, restaurantId) {
  // All explicit receipts already have payment_allocations from their trigger.
  // The demo's synthetic pooled history remains visibly unresolved: no guessed
  // attribution is seeded as if a restaurant had supplied evidence.
  const { rows: [order] } = await pg.query(`insert into orders
    (restaurant_id,items,subtotal,total,status) values($1,'[]',25,25,'pending_payment') returning id`, [restaurantId]);
  await pg.query("select settle_sale($1,$2,'cash','demo-cashier@tabletap.dev','received')", [restaurantId, order.id]);
  await pg.query("select prepare_order_refund($1,$2,'demo@tabletap.dev','[]',true,null,null,null)", [restaurantId, order.id]);
  // refund_operations, refund_allocations and order_adjustments now explain
  // why that receipt is retained but no longer covers a live dish.
  // refund_attempts is deliberately empty: no real Stripe call is fabricated.
  await pg.query(`insert into user_logs(restaurant_id,actor_email,entity,action,detail)
    values($1,'demo-cashier@tabletap.dev','bill','paid','amount=25.00 method=cash')`, [restaurantId]);
}
