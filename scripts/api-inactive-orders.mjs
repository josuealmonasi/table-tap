import assert from "node:assert/strict";
import { MARK } from "./api-fixtures.mjs";

// Historical write-offs can retain a live source status. Never reopen them;
// keep the pass and stale actions consistent with the original books.
export function inactiveOrderCases() {
  return ["owner", "kitchen"].flatMap(as => ["PATCH", "POST"].map(method => {
    let id, ticket, original;
    return {
      name: `${method} /api/orders${method === "POST" ? "/station" : ""} (${as} inactive order)`,
      as, method, path: method === "POST" ? "/api/orders/station" : "/api/orders", expect: [409],
      expectError: /no longer active|ya no está activo/i,
      arrange: async f => {
        const { data, error } = await f.admin.from("orders").insert({
          restaurant_id: f.restaurant.id, status: "received", written_off: true,
          total: 20, subtotal: 20, note: MARK, currency: "MXN", paid: false,
          items: [{ name: "Inactive fixture", price: 20, qty: 1 }],
        }).select("*").single();
        if (error) throw new Error(error.message);
        id = data.id; ticket = data.kitchen_ticket_id; original = data;
        return async () => {
          const { error: cleanupError } = await f.admin.from("orders").delete().eq("id", id);
          if (cleanupError) throw new Error(cleanupError.message);
        };
      },
      body: () => method === "POST" ? { id: as === "kitchen" ? ticket : id, station: "kitchen" }
        : { id: as === "kitchen" ? ticket : id, status: "preparing", from: "received" },
      effect: async f => {
        const [order, projection, payments] = await Promise.all([
          f.admin.from("orders").select("*").eq("id", id).single(),
          f.admin.from("kitchen_tickets").select("*").eq("id", ticket).single(),
          f.admin.from("payments").select("id").eq("order_id", id),
        ]);
        for (const read of [order, projection, payments]) if (read.error) return read.error.message;
        assert.deepEqual(order.data, original, "Refusal changed the source order");
        assert.equal(projection.data.status, "cancelled", "Private ticket remains actionable");
        assert(!("written_off" in projection.data) && !("total" in projection.data), "Financial facts reached the kitchen");
        assert.equal(payments.data.length, 0, "Refusal wrote money");
        return true;
      },
    };
  }));
}
