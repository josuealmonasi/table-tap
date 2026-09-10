import { describe, expect, it } from "vitest";
import { readyToDeliver } from "@/lib/ready-tables";
import type { Order } from "@/lib/types";

function ticket(over: Partial<Order>): Order {
  return {
    id: "o1",
    restaurant_id: "r1",
    table_id: "t4",
    table_label: "4",
    status: "ready",
    items: [{ name: "Pizza", emoji: "🍕", price: 100, qty: 1, mods: {} }],
    created_at: "2026-09-10T12:00:00Z",
    ...over,
  } as unknown as Order;
}

describe("what is ready to carry out", () => {
  it("is one trip per table, however many tickets", () => {
    const [table] = readyToDeliver([
      ticket({ id: "a", created_at: "2026-09-10T12:05:00Z" }),
      ticket({ id: "b", created_at: "2026-09-10T12:00:00Z" }),
    ]);
    expect(table.orderIds).toEqual(["a", "b"]);
    expect(table.dishes).toBe(2);
    // The wait the diners feel is the oldest of them, not the newest.
    expect(table.since).toBe("2026-09-10T12:00:00Z");
  });

  it("counts the dishes, not the tickets", () => {
    const [table] = readyToDeliver([
      ticket({
        items: [
          { name: "Pizza", emoji: "🍕", price: 100, qty: 2, mods: {} },
          { name: "Agua", emoji: "💧", price: 20, qty: 3, mods: {} },
        ],
      } as Partial<Order>),
    ]);
    expect(table.dishes).toBe(5);
  });

  it("leaves what is still cooking alone", () => {
    expect(
      readyToDeliver([
        ticket({ id: "a", status: "received" }),
        ticket({ id: "b", status: "preparing" }),
        ticket({ id: "c", status: "completed" }),
      ]),
    ).toEqual([]);
  });

  it("gives a counter order its own trip, named by its code", () => {
    const [counter] = readyToDeliver([
      ticket({ id: "abcd1234-0000-0000-0000-000000000000", table_id: null, table_label: null }),
    ]);
    expect(counter.label).toBeNull();
    expect(counter.code).toBe("ORD-ABCD");
    expect(counter.orderIds).toHaveLength(1);
  });

  it("does not fold two counter orders into one trip", () => {
    const trips = readyToDeliver([
      ticket({ id: "11111111-0000-0000-0000-000000000000", table_id: null, table_label: null }),
      ticket({ id: "22222222-0000-0000-0000-000000000000", table_id: null, table_label: null }),
    ]);
    expect(trips).toHaveLength(2);
  });

  it("puts the longest wait first", () => {
    const trips = readyToDeliver([
      ticket({ id: "new", table_id: "t9", table_label: "9", created_at: "2026-09-10T12:30:00Z" }),
      ticket({ id: "old", table_id: "t2", table_label: "2", created_at: "2026-09-10T11:00:00Z" }),
    ]);
    expect(trips.map(x => x.label)).toEqual(["2", "9"]);
  });
});
