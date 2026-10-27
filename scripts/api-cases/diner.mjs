import { ROOM_ADDRESS } from "./helpers.mjs";

export function dinerCases(fx) {
  const { restaurant, table, dish, paidOrder } = fx;
  const r = restaurant.id;
  return [
    // ── what the diner touches, with no session ──────────────────────────
    { name: "GET  /api/session", as: "diner", method: "GET",
      path: `/api/session?id=${fx.sessionId ?? ""}`, expect: fx.sessionId ? [200] : [400] },
    { name: "GET  /api/bill (table)", as: "diner", method: "GET",
      path: `/api/bill?restaurantId=${r}&tableId=${table.id}`, expect: [200] },
    { name: "GET  /api/order-status", as: "diner", method: "GET",
      path: `/api/order-status?id=${paidOrder}`, expect: [200] },
    // A room behind one address, which is what a restaurant's Wi-Fi is. The
    // limit was 120 a minute, sized for one phone; thirty diners on the menu
    // used it up, and every tracker in the room froze. 130 asks first, then
    // this one must still be answered. On production the address is the
    // runner's own, because Vercel sets the header itself.
    { name: "GET  /api/order-status (a full room behind one address)", as: "diner", method: "GET",
      path: `/api/order-status?id=${paidOrder}`, headers: { "x-forwarded-for": ROOM_ADDRESS },
      arrange: async f => {
        const ask = () => fetch(`${f.base}/api/order-status?id=${paidOrder}`, {
          headers: { "x-forwarded-for": ROOM_ADDRESS },
        }).then(res => res.status);
        const clear = () => f.admin.from("rate_limits").delete().eq("bucket", `order-status:${ROOM_ADDRESS}`);
        try {
          for (let batch = 0; batch < 13; batch++) await Promise.all(Array.from({ length: 10 }, ask));
        } catch (e) {
          await clear(); // a room half-counted would refuse the next run's first asks
          throw e;
        }
        return clear;
      },
      expect: [200] },
    { name: "POST /api/service-requests", as: "diner", method: "POST", path: "/api/service-requests",
      body: { restaurantId: r, tableId: table.id, kind: "waiter" }, expect: [200] },
    { name: "PATCH /api/service-requests (kitchen answers a call without a table id)", as: "kitchen",
      method: "PATCH", path: "/api/service-requests",
      arrange: async f => {
        const { data, error } = await f.admin.from("service_requests").insert({
          restaurant_id: r, table_id: table.id, table_label: table.label, kind: "bill",
        }).select("id").single();
        if (error) throw new Error(error.message);
        f.kitchenCall = data.id;
        return () => f.admin.from("service_requests").delete().eq("id", data.id);
      },
      body: f => ({ id: f.kitchenCall }), expect: [200],
      check: d => d.ok === true && Object.keys(d).length === 1 || "answering a call returned more than its result",
      effect: async f => {
        const { data, error } = await f.admin.from("kitchen_requests").select("status")
          .eq("id", f.kitchenCall).single();
        return !error && data?.status === "done" || "the kitchen's live call stayed open";
      } },
    { name: "POST /api/ratings/pending", as: "diner", method: "POST", path: "/api/ratings/pending",
      body: { restaurantId: r, orderIds: [paidOrder] }, expect: [200],
      check: d => Array.isArray(d.dishes) && d.dishes.length > 0 || "did not offer the dish that was bought" },
    { name: "POST /api/ratings", as: "diner", method: "POST", path: "/api/ratings",
      body: { restaurantId: r, ratings: [{ orderId: paidOrder, itemId: dish.id, rating: 5 }] },
      expect: [200], check: d => d.saved === 1 || `saved ${d.saved}` },
  ];
}
