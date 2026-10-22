import { randomUUID } from "node:crypto";
import { twoSittingCollection } from "./api-part-collection.mjs";

/** Refusals are judged by unchanged receipts, allocations and orders. */
export function collectionRefusals() {
  return ["tip", "balance"].map(kind => {
    const seeded = twoSittingCollection();
    const tableId = seeded.tableId;
    let before;
    const snapshot = async f => {
      const { data: orders, error } = await f.admin.from("orders").select("id,total,tip,paid,session_id")
        .eq("restaurant_id",f.restaurant.id).eq("table_id",tableId).order("id");
      if (error) throw new Error(error.message);
      const sessions = orders.map(o => o.session_id);
      const { data: payments, error: paymentError } = await f.admin.from("payments").select("id,amount,tip")
        .eq("restaurant_id",f.restaurant.id).in("session_id",sessions).order("id");
      if (paymentError) throw new Error(paymentError.message);
      const { data: allocations, error: allocationError } = await f.admin.from("payment_allocations").select("id,amount,tip")
        .eq("restaurant_id",f.restaurant.id).in("order_id",orders.map(o => o.id)).order("id");
      if (allocationError) throw new Error(allocationError.message);
      return JSON.stringify({ orders,payments,allocations });
    };
    return {
      name: `POST /api/table-payment/part (S21 ${kind === "tip" ? "ten plus fifty is refused before collection" : "a reviewed hundred now owing fifty is refused"})`,
      as: "waiter", method: "POST", path: "/api/table-payment/part", expect: [kind === "tip" ? 400 : 409],
      arrange: async f => {
        const clean = await seeded.arrange(f);
        try {
          if (kind === "balance") {
            const { error } = await f.admin.from("orders").update({ total: 25, subtotal: 25 })
              .eq("restaurant_id",f.restaurant.id).eq("table_id",tableId);
            if (error) throw new Error(error.message);
          }
          before = await snapshot(f);
          return clean;
        } catch (error) { await clean(); throw error; }
      },
      body: f => ({ tableId, expected: kind === "tip" ? 200 : 100, currency: f.restaurant.currency,
        amount: kind === "tip" ? 10 : 100, tip: kind === "tip" ? 50 : 0, method: "cash", ref: randomUUID() }),
      effect: async f => await snapshot(f) === before || "a refused collection changed money or the orders",
    };
  });
}
