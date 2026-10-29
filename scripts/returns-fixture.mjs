import { randomUUID } from "node:crypto";

const checked = async promise => {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
};

/** A private completed sale. Never borrow a demo order that another case
 * needs, and remove only the records this fixture created. */
export async function returnsFixture(admin, restaurantId, method = "cash") {
  const orderId = randomUUID(), paymentId = randomUUID(), ref = randomUUID();
  const cleanup = async () => {
    // The receipt first: its allocations, and the return's allocations on them,
    // go with it. Deleting the order first set the receipt's order to null
    // with its allocations already gone, and the deferred receipt check
    // refused the cleanup (#575's api gate). The order's cascade then removes
    // its own immutable return plan; deleting an adjustment directly would
    // weaken the same guard the case is testing.
    await checked(admin.from("payments").delete().eq("id", paymentId).eq("restaurant_id", restaurantId));
    await checked(admin.from("orders").delete().eq("id", orderId).eq("restaurant_id", restaurantId));
  };
  try {
    await checked(admin.from("orders").insert({ id: orderId, restaurant_id: restaurantId, table_id: null,
      table_label: `return-fixture-${ref.slice(0, 8)}`, items: [], subtotal: 70, discount: 0, service_fee: 0,
      tip: 10, tax_pct: 0, total: 80, currency: "MXN", status: "completed", paid: false, note: "returns-fixture" }));
    await checked(admin.from("payments").insert({ id: paymentId, restaurant_id: restaurantId, order_id: orderId,
      amount: 80, tip: 10, method, currency: "MXN", actor_email: "returns-fixture", client_ref: ref }));
    await checked(admin.from("orders").update({ paid: true, pay_method: method }).eq("id", orderId).eq("restaurant_id", restaurantId));
    return { orderId, paymentId, cleanup, body: { action: "prepare", orderId, amountCents: 8000, reason: "Returns API fixture", note: "",
      ref, expected: { totalCents: 8000, tipCents: 1000, serviceCents: 0 } } };
  } catch (error) { await cleanup(); throw error; }
}
