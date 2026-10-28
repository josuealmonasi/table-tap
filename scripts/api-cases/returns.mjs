import { returnsFixture } from "../returns-fixture.mjs";

export function completedReturnCases(fx) {
  return [
    ...["cash", "card"].map(method => ({ name: `POST /api/order-refunds (completed ${method} sale, replay and confirmed payout)`,
      as: "manager", method: "POST", path: "/api/order-refunds",
      arrange: async f => { f.returnCase = await returnsFixture(f.admin, fx.restaurant.id, method); return f.returnCase.cleanup; },
      body: f => f.returnCase.body, expect: [200],
      check: async (data, f) => {
        if (data.outcome !== "prepared" || data.operations.length !== 1) return "a full return did not prepare one exact operation";
        const post = async body => {
          const response = await fetch(`${f.base}/api/order-refunds`, { method: "POST",
            headers: { "Content-Type": "application/json", Cookie: f.who.manager }, body: JSON.stringify(body) });
          return { status: response.status, data: await response.json() };
        };
        const replay = await post(f.returnCase.body);
        if (replay.status !== 200 || !replay.data.replay || replay.data.adjustment !== data.adjustment) return "a lost full-return reply did not replay at zero";
        const changed = await post({ ...f.returnCase.body, amountCents: 7000 });
        if (changed.status !== 409) return "a changed reference did not conflict";
        const payout = { id: data.operations[0].id, confirmReturned: true, drawer: "me" };
        const first = await post(payout), second = await post(payout);
        if (!first.data.completed || !second.data.completed) return "the confirmed payout did not complete and replay";
        const { data: order, error } = await f.admin.from("orders").select("total, tip, status, paid, written_off")
          .eq("id", f.returnCase.orderId).eq("restaurant_id", fx.restaurant.id).single();
        if (error) return error.message;
        return order.paid && order.status === "completed" && !order.written_off && Number(order.total) === 0 && Number(order.tip) === 0
          || "the return reopened debt or changed the sale's completed status";
      } })),
    ...["waiter", "cashier", "kitchen"].map(role => ({ name: `POST /api/order-refunds (${role} cannot prepare)`, as: role,
      method: "POST", path: "/api/order-refunds", body: { action: "prepare" }, expect: [403] })),
    { name: "POST /api/order-refunds (duplicate corrections use refunds due)", as: "manager", method: "POST", path: "/api/order-refunds",
      body: { action: "prepare", dueId: "duplicate" }, expect: [409], expectError: /pago de más|extra payment/i },
  ];
}
