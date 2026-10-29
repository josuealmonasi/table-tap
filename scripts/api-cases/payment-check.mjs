/** No saved card page: checking this fixture cannot call Stripe or move money. */
export function paymentCheckCases(fx) {
  return ["owner", "manager", "cashier", "waiter"].map(role => {
    let before;
    const snapshot = async f => {
      const order = await f.admin.from("orders").select("paid, status, total, account_id, written_off").eq("id", fx.unpaidOrder).single();
      const payments = await f.admin.from("payments").select("id, amount").eq("order_id", fx.unpaidOrder).order("id");
      if (order.error || payments.error) throw new Error("Could not read the payment-check fixture");
      return JSON.stringify([order.data, payments.data]);
    };
    return { name: `POST /api/checkout/check (${role}, no saved payment)`, as: role, method: "POST",
      path: "/api/checkout/check", body: { kind: "orders", orderIds: [fx.unpaidOrder] }, expect: [200],
      arrange: async f => { before = await snapshot(f); },
      check: async (data, f) => {
        if (data.outcome !== "missing_identity") return `unexpected check result: ${data.outcome}`;
        return await snapshot(f) === before || "checking changed the order or its payments";
      },
    };
  });
}
