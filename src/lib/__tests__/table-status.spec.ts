import { describe, expect, it } from "vitest";
import { statusFor, tableStatuses } from "@/lib/table-status";
import type { Order } from "@/lib/types";

const NOW = new Date("2026-08-19T20:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3600_000).toISOString();

function order(over: Partial<Order> = {}): Order {
  return {
    id: "o1",
    table_id: "t1",
    total: 100,
    paid: false,
    written_off: false,
    status: "ready",
    created_at: ago(1),
    ...over,
  } as Order;
}

describe("is this table safe to seat", () => {
  it("calls a table with nothing on it free", () => {
    expect(statusFor(tableStatuses([], NOW), "t1").free).toBe(true);
  });

  it("holds a table while somebody still owes", () => {
    const s = statusFor(tableStatuses([order()], NOW), "t1");
    expect(s.free).toBe(false);
    expect(s.owed).toBe(100);
  });

  it("frees the table once everyone has paid in full", () => {
    const orders = [order({ id: "a", paid: true }), order({ id: "b", paid: true })];
    expect(statusFor(tableStatuses(orders, NOW), "t1").free).toBe(true);
  });

  it("stays held while one of the party has not paid", () => {
    const orders = [order({ id: "a", paid: true }), order({ id: "b", total: 40 })];
    const s = statusFor(tableStatuses(orders, NOW), "t1");
    expect(s.free).toBe(false);
    expect(s.owed).toBe(40);
  });

  it("frees the table when a walkout is written off", () => {
    // The manager confirmed the loss, so the table is not held hostage by it.
    const orders = [order({ id: "a", paid: true }), order({ id: "b", written_off: true })];
    expect(statusFor(tableStatuses(orders, NOW), "t1").free).toBe(true);
  });

  it("does not hold a table for last night's forgotten ticket", () => {
    // The debt is still real and still on the manager's open bills — it just
    // is not a reason to refuse to seat anybody today.
    expect(statusFor(tableStatuses([order({ created_at: ago(20) })], NOW), "t1").free).toBe(true);
  });

  it("adds up a party that ordered separately", () => {
    const orders = [order({ id: "a", total: 30 }), order({ id: "b", total: 12.5 })];
    expect(statusFor(tableStatuses(orders, NOW), "t1").owed).toBe(42.5);
  });

  it("keeps tables apart", () => {
    const orders = [order({ id: "a" }), order({ id: "b", table_id: "t2", total: 55 })];
    const map = tableStatuses(orders, NOW);
    expect(statusFor(map, "t1").owed).toBe(100);
    expect(statusFor(map, "t2").owed).toBe(55);
  });
});
