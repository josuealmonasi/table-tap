import { randomUUID } from "node:crypto";
import { MARK } from "./api-fixtures.mjs";

/** Two sittings, one handful: check receipts and their order coverage by effect. */
export function twoSittingCollection() {
  const tableId = randomUUID();
  const sessions = [randomUUID(), randomUUID()];
  const orders = [randomUUID(), randomUUID()];
  const ref = `${MARK}-two-sittings-${randomUUID()}`;
  const label = `${MARK}-${tableId}`;
  const checked = async query => {
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    tableId,
    name: "POST /api/table-payment/part (two sittings, the whole collection reaches the ledger)",
    as: "waiter", method: "POST", path: "/api/table-payment/part",
    body: f => ({ tableId, expected: 200, currency: f.restaurant.currency, amount: 200, tip: 10, method: "cash", ref }),
    expect: [200],
    arrange: async f => {
      const db = f.admin;
      const r = f.restaurant.id;
      const clean = async () => {
        // Payments cascade their allocations; remove them before the orders.
        // The case's own label also finds its close/log and print side effects.
        await checked(db.from("payments").delete().eq("restaurant_id", r).in("session_id", sessions));
        await checked(db.from("user_logs").delete().eq("restaurant_id", r).like("detail", `%${label}%`));
        await checked(db.from("print_jobs").delete().in("order_id", orders));
        await checked(db.from("orders").delete().eq("restaurant_id", r).in("id", orders));
        await checked(db.from("table_sessions").delete().eq("restaurant_id", r).in("id", sessions));
        await checked(db.from("restaurant_tables").delete().eq("restaurant_id", r).eq("id", tableId));
      };
      try {
        await checked(db.from("restaurant_tables").insert({ id: tableId, restaurant_id: r, label }));
        const old = new Date(Date.now() - 3_600_000).toISOString();
        const now = new Date().toISOString();
        await checked(db.from("table_sessions").insert(sessions.map((id, n) => ({
          id, restaurant_id: r, table_id: tableId, opened_at: n === 0 ? old : now,
          closed_at: n === 0 ? now : null, close_reason: n === 0 ? "expired" : null,
        }))));
        await checked(db.from("orders").insert(orders.map((id, n) => ({
          id, restaurant_id: r, table_id: tableId, table_label: label, session_id: sessions[n],
          items: [{ itemId: f.dish.id, name: f.dish.name, price: 100, qty: 1, mods: {} }],
          subtotal: 100, total: 100, tip: 0, service_fee: 0, tax_pct: 0, discount: 0,
          status: "completed", paid: false, note: MARK, created_at: n === 0 ? old : now,
          currency: f.restaurant.currency,
        }))));
        return clean;
      } catch (error) {
        await clean();
        throw error;
      }
    },
    check: d => d.ok === true && d.settled === true || "the two sittings did not close",
    effect: async f => {
      const receipts = await checked(f.admin.from("payments").select("id, session_id, amount, tip, client_ref")
        .eq("restaurant_id", f.restaurant.id).in("session_id", sessions));
      const sum = rows => rows.reduce((total, row) => total + Number(row.amount), 0);
      if (receipts.length !== 2 || Math.abs(sum(receipts) - 210) > 0.005) {
        return `${receipts.length} receipts recorded ${sum(receipts)} of MX$210`;
      }
      for (const [n, id] of sessions.entries()) {
        const receipt = receipts.find(p => p.session_id === id);
        if (!receipt || Number(receipt.amount) !== (n === 0 ? 110 : 100)
          || Number(receipt.tip) !== (n === 0 ? 10 : 0) || receipt.client_ref !== `${ref}#${id}`) {
          return "a sitting received the wrong amount, tip or reference";
        }
      }
      const allocations = await checked(f.admin.from("payment_allocations").select("order_id, amount, tip")
        .eq("restaurant_id", f.restaurant.id).in("order_id", orders));
      if (allocations.length !== 2 || Math.abs(sum(allocations) - 210) > 0.005) return "the receipts did not cover both orders";
      const food = await checked(f.admin.from("orders").select("id, paid, total, tip")
        .eq("restaurant_id", f.restaurant.id).in("id", orders));
      return food.length === 2 && food.every(o => o.paid) && Math.abs(food.reduce((s, o) => s + Number(o.total), 0) - 210) < 0.005
        || "the paid orders and the ledger disagree";
    },
  };
}
