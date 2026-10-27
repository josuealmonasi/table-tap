import { MARK } from "../api-fixtures.mjs";
import { inactiveOrderCases } from "../api-inactive-orders.mjs";
import { kitchenTicketId } from "./helpers.mjs";

export function orderBoardCases(fx) {
  const { table, unpaidOrder } = fx;
  return [
    { name: "GET  /api/table-bill (table)", as: "waiter", method: "GET",
      path: `/api/table-bill?tableId=${table.id}`, expect: [200] },
    { name: "GET  /api/table-bill (counter)", as: "cashier", method: "GET",
      path: `/api/table-bill?orderId=${unpaidOrder}`, expect: [200],
      check: d => d.orders?.length === 1 || "did not find the counter order" },
    { name: "GET  /api/bill/discount/options", as: "manager", method: "GET",
      path: `/api/bill/discount/options?tableId=${table.id}`, expect: [200] },
    ...inactiveOrderCases(),
    // ── Stations: the bar and the kitchen each finish their part ─────────
    // One order with a drink and a plate. The bar finishing does not make it
    // ready; the kitchen finishing after it does. The floor cannot press it,
    // and a station with nothing in the order cannot either.
    { name: "POST /api/orders/station (the bar finishes its part)", as: "kitchen", method: "POST",
      path: "/api/orders/station",
      body: async f => ({ id: await kitchenTicketId(f, f.stationOrder), station: "bar" }), expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("orders").select("status, stations_ready").eq("id", f.stationOrder).single();
        if (d.status !== "preparing") return `answered ${d.status}, not preparing`;
        return data?.status === "preparing" && JSON.stringify(data.stations_ready) === '["bar"]' || `stored ${JSON.stringify(data)}`;
      } },
    { name: "POST /api/orders/station (a waiter cannot press it)", as: "waiter", method: "POST",
      path: "/api/orders/station", body: f => ({ id: f.stationOrder, station: "kitchen" }), expect: [403] },
    { name: "POST /api/orders/station (a station with nothing here)", as: "kitchen", method: "POST",
      path: "/api/orders/station", body: async f => ({ id: await kitchenTicketId(f, f.kitchenOnlyOrder), station: "bar" }), expect: [409],
      expectError: /nada que preparar|nothing to make/i },
    { name: "POST /api/orders/station (the kitchen finishes: the order is ready)", as: "kitchen", method: "POST",
      path: "/api/orders/station", body: async f => ({ id: await kitchenTicketId(f, f.stationOrder), station: "kitchen" }), expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("orders").select("status").eq("id", f.stationOrder).single();
        return d.status === "ready" && data?.status === "ready" || `answered ${d.status}, stored ${data?.status}`;
      } },
    { name: "POST /api/orders/station (an order already ready)", as: "kitchen", method: "POST",
      path: "/api/orders/station", body: async f => ({ id: await kitchenTicketId(f, f.stationOrder), station: "bar" }), expect: [409],
      expectError: /ya avanzó|already moved on/i },
    { name: "PATCH /api/orders (move)", as: "kitchen", method: "PATCH", path: "/api/orders",
      body: async f => ({ id: await kitchenTicketId(f, unpaidOrder), status: "preparing" }), expect: [200] },
    // A move that waited out a dropped connection carries the status it began
    // at. The order is "preparing" by now, so a queued "from: received" is
    // older than the board and must be refused rather than drag it backwards —
    // and the order must still be where the live board put it.
    { name: "PATCH /api/orders (a stale queued move loses)", as: "kitchen", method: "PATCH",
      path: "/api/orders", body: async f => ({ id: await kitchenTicketId(f, unpaidOrder), status: "received", from: "received" }),
      expect: [409], expectError: /ya cambió de etapa|has moved on/i,
      effect: async f => {
        const { data } = await f.admin.from("orders").select("status").eq("id", unpaidOrder).single();
        return data?.status === "preparing" || `a stale move left the order ${data?.status}`;
      } },
  ];
}

export function tableOrderCases(fx) {
  const { table, dish } = fx;
  return [
    // A waiter takes an order at a table. Unpaid: the table settles at the end.
    // `note: MARK` is not decoration: teardown deletes orders by that note, so a
    // case that places one without it leaves it behind for good. This one did,
    // every run, and the kitchen ticket with it.
    { name: "POST /api/table-order", as: "waiter", method: "POST", path: "/api/table-order",
      body: { tableId: table.id, note: MARK, items: [{ itemId: dish.id, name: dish.name,
        emoji: dish.emoji, price: Number(dish.price), qty: 1, mods: {} }] },
      expect: [200, 403],
      // 403 when the tier does not carry it; 200 says it landed owing.
      check: d => !d.orderId || Number(d.total) > 0 || "created an order that owes nothing" },
    { name: "POST /api/table-order (kitchen refused)", as: "kitchen", method: "POST",
      path: "/api/table-order",
      body: { tableId: table.id, items: [{ itemId: dish.id, name: dish.name, emoji: dish.emoji,
        price: Number(dish.price), qty: 1, mods: {} }] },
      expect: [403] },
    { name: "POST /api/table-order (cashier refused — they have the till)", as: "cashier",
      method: "POST", path: "/api/table-order",
      body: { tableId: table.id, items: [{ itemId: dish.id, name: dish.name, emoji: dish.emoji,
        price: Number(dish.price), qty: 1, mods: {} }] },
      expect: [403] },
    { name: "POST /api/table-order (no table)", as: "waiter", method: "POST",
      path: "/api/table-order",
      body: { items: [{ itemId: dish.id, name: dish.name, emoji: dish.emoji,
        price: Number(dish.price), qty: 1, mods: {} }] },
      expect: [400] },
    { name: "POST /api/table-order (another restaurant's table)", as: "waiter", method: "POST",
      path: "/api/table-order",
      body: { tableId: "00000000-0000-4000-8000-000000000000",
        items: [{ itemId: dish.id, name: dish.name, emoji: dish.emoji,
          price: Number(dish.price), qty: 1, mods: {} }] },
      expect: [404, 403] },
  ];
}
