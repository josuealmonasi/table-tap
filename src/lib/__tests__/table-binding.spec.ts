import { describe, expect, it } from "vitest";
import { unpaidOrders } from "@/lib/table-bill";
import type { Order } from "@/lib/types";

function order(over: Partial<Order> = {}): Order {
  return {
    id: "o1",
    session_id: "s1",
    total: 20,
    paid: false,
    written_off: false,
    status: "ready",
    ...over,
  } as Order;
}

// What /api/session decides with, and what closes a sitting: both ask the same
// question — is anything on this sitting still owed?
describe("when a sitting stops holding somebody", () => {
  it("holds while an order is unpaid", () => {
    expect(unpaidOrders([order()])).toHaveLength(1);
  });

  it("frees once everything is paid", () => {
    expect(unpaidOrders([order({ paid: true }), order({ id: "o2", paid: true })])).toHaveLength(0);
  });

  it("frees when the debt is written off", () => {
    // The manager confirmed the loss, so the diner is not held to a table
    // whose bill nobody is collecting any more.
    expect(unpaidOrders([order({ written_off: true })])).toHaveLength(0);
  });

  it("frees when the order was cancelled", () => {
    expect(unpaidOrders([order({ status: "cancelled" })])).toHaveLength(0);
  });

  it("still holds if one of several is unpaid", () => {
    const rows = [order({ id: "a", paid: true }), order({ id: "b" })];
    expect(unpaidOrders(rows).map(o => o.id)).toEqual(["b"]);
  });
});
