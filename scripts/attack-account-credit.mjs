import { randomUUID } from "node:crypto";

export async function attackAccountCredit({ admin, post, who, home, neighbour, ok, bad, account, order }) {
  const own = await account(home.id, 1000), other = await account(neighbour.id, 1000);
  const mine = await order(home.id, 50, { account_id: own, status: "completed" });
  const theirs = await order(neighbour.id, 50, { account_id: other, status: "completed" });
  const body = id => ({ orderId: id, amountCents: 1000, expectedCents: 5000, reason: "error", note: "attack-account-credit", requestId: randomUUID() });
  const state = async (restaurant, id) => {
    const results = await Promise.all([
      admin.from("orders").select("total, tip, service_fee, paid, written_off").eq("restaurant_id", restaurant).eq("id", id).single(),
      admin.from("order_adjustments").select("id").eq("restaurant_id", restaurant).eq("order_id", id),
      admin.from("payments").select("id, amount").eq("restaurant_id", restaurant).eq("account_id", restaurant === home.id ? own : other),
    ]);
    for (const result of results) if (result.error) throw result.error;
    return { order: results[0].data, adjustments: results[1].data, payments: results[2].data };
  };
  try {
    for (const role of ["cashier", "kitchen", "waiter"]) {
      const before = await state(home.id, mine);
      const response = await post("/api/accounts/credit", body(mine), who[role]);
      const after = await state(home.id, mine);
      response.status === 403 && JSON.stringify(before) === JSON.stringify(after)
        ? ok(`${role} cannot credit account debt by effect`) : bad(`${role} changed account debt or received the wrong refusal`);
    }
    const before = await state(neighbour.id, theirs);
    const foreign = await post("/api/accounts/credit", body(theirs), who.manager);
    foreign.status === 404 && JSON.stringify(before) === JSON.stringify(await state(neighbour.id, theirs))
      ? ok("a manager cannot credit another restaurant's order") : bad("cross-restaurant credit changed money or the refusal differs");
    const ask = body(mine);
    const first = await post("/api/accounts/credit", ask, who.manager);
    const again = await post("/api/accounts/credit", ask, who.manager);
    const after = await state(home.id, mine);
    first.status === 200 && again.status === 200 && Number(after.order.total) === 40
      && !after.order.paid && !after.order.written_off && after.adjustments.length === 1 && after.payments.length === 0
      ? ok("retrying an account credit reduces debt once and creates no receipt") : bad("account credit replay did not preserve exactly one reduction");
  } finally {
    // The caller deletes these orders/accounts and cascades immutable rows.
    for (const [restaurant, id] of [[home.id, mine], [neighbour.id, theirs]]) {
      const { error } = await admin.from("user_logs").delete().eq("restaurant_id", restaurant).eq("entity", "bill").like("detail", `%order=${id}%`);
      if (error) throw error;
    }
  }
}
