import { createHash, randomBytes } from "node:crypto";
import { MARK } from "../api-fixtures.mjs";

/**
 * A diner's pay-later order at a table (2026-11-26).
 *
 * The phone that opens an empty table with a card order is let in unaided. If
 * it never pays, it must not go on to send food to the kitchen on the bill:
 * only once the sitting has a paid order. And no sitting takes more than 15
 * unpaid diner orders. Each case seats its own phone on its own table, so the
 * refusal is the one named and nothing else at the restaurant moves.
 */
async function seat(f, state, { autoApproved, paidOrder = false, unpaidOrders = 0 }) {
  const r = f.restaurant.id;
  const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  const table = must(await f.admin.from("restaurant_tables")
    .insert({ restaurant_id: r, label: `${MARK}-paylater-${randomBytes(3).toString("hex")}` }).select("id").single());
  state.table = table.id;
  const undo = async () => {
    // The accepted round took stock: it goes back on the shelf with the order.
    const { data: placed } = await f.admin.from("orders").select("stock_reservation_id").eq("table_id", table.id);
    for (const { stock_reservation_id: reservation } of placed ?? []) {
      if (reservation) await f.admin.rpc("release_stock_reservation", { p_restaurant: r, p_reservation: reservation });
    }
    await f.admin.from("orders").delete().eq("table_id", table.id);
    await f.admin.from("table_sessions").delete().eq("table_id", table.id);
    await f.admin.from("restaurant_tables").delete().eq("id", table.id);
  };
  try {
    const session = must(await f.admin.from("table_sessions")
      .insert({ restaurant_id: r, table_id: table.id }).select("id").single());
    state.session = session.id;
    const token = randomBytes(32).toString("base64url");
    const member = must(await f.admin.from("table_session_members").insert({
      session_id: session.id, token_hash: createHash("sha256").update(token).digest("hex"),
      status: "approved", decided_at: new Date().toISOString(),
      auto_approved: autoApproved, decided_by: autoApproved ? null : `${MARK}@tabletap.shop`,
    }).select("id").single());
    state.cookie = `tt-table-member=${token}`;
    const order = paid => ({
      restaurant_id: r, table_id: table.id, table_label: MARK, session_id: session.id, diner: member.id,
      subtotal: 10, total: 10, currency: "MXN", paid, pay_method: paid ? "cash" : null,
      status: "received", items: [], note: MARK,
    });
    const rows = [...(paidOrder ? [order(true)] : []), ...Array.from({ length: unpaidOrders }, () => order(false))];
    if (rows.length) must(await f.admin.from("orders").insert(rows));
    state.before = rows.length;
    return undo;
  } catch (error) { await undo(); throw error; }
}

async function ordersOn(f, session) {
  const { count, error } = await f.admin.from("orders")
    .select("id", { count: "exact", head: true }).eq("session_id", session);
  if (error) throw new Error(error.message);
  return count;
}

export function dinerPayLaterCases(fx) {
  const { restaurant, dish } = fx;
  const item = () => [{ itemId: dish.id, name: dish.name, price: Number(dish.price), qty: 1, emoji: "🍽️", mods: {} }];
  const unchanged = state => async f => {
    const now = await ordersOn(f, state.session);
    return now === state.before || `the sitting went from ${state.before} orders to ${now}`;
  };
  const caseFor = ({ name, setup, ref = false, ip, expect, expectError, effect }) => {
    const state = {};
    return {
      name: `POST /api/checkout (${name})`, as: "diner", method: "POST", path: "/api/checkout",
      headers: () => ({ cookie: state.cookie, "x-forwarded-for": ip }),
      arrange: f => seat(f, state, setup),
      body: () => ({ restaurantId: restaurant.id, tableId: state.table, payLater: true, note: MARK, items: item(),
        ...(ref ? { ref: crypto.randomUUID() } : {}) }),
      expect, expectError, effect: effect(state),
    };
  };
  return [
    caseFor({ name: "an unpaid card opener asks for pay-later", setup: { autoApproved: true }, ip: "203.0.113.231",
      expect: [409], expectError: /pedido pagado|paid order/i, effect: unchanged }),
    caseFor({ name: "an unpaid card opener asks for pay-later with a reference", setup: { autoApproved: true }, ref: true,
      ip: "203.0.113.232", expect: [409], expectError: /pedido pagado|paid order/i, effect: unchanged }),
    // The other money direction: the diner who paid up front adds a round.
    caseFor({ name: "a pay-later round after the opener paid", setup: { autoApproved: true, paidOrder: true },
      ip: "203.0.113.233", expect: [200],
      effect: state => async f => {
        const now = await ordersOn(f, state.session);
        return now === state.before + 1 || `the sitting went from ${state.before} orders to ${now}`;
      } }),
    caseFor({ name: "a staff-approved phone at a sitting with 15 unpaid orders",
      setup: { autoApproved: false, unpaidOrders: 15 }, ip: "203.0.113.234",
      expect: [409], expectError: /sin pagar|unpaid orders/i, effect: unchanged }),
  ];
}
