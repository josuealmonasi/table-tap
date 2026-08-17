import { describe, expect, it } from "vitest";
import { billTotal, discountableOrders, spreadDiscount } from "@/lib/staff-discount";
import { matchesBill, openBills } from "@/lib/open-bills";
import type { Order } from "@/lib/types";

function order(id: string, total: number, over: Partial<Order> = {}): Order {
  return {
    id,
    restaurant_id: "r1",
    table_id: "t1",
    table_label: "1",
    status: "completed",
    subtotal: total,
    service_fee: 0,
    tip: 0,
    tax_pct: 0,
    total,
    currency: "MXN",
    items: [],
    note: null,
    pay_method: null,
    paid: false,
    stripe_payment_intent: null,
    stripe_refund_id: null,
    created_at: "2026-08-15T12:00:00Z",
    ...over,
  };
}

describe("which orders a staff discount may touch", () => {
  it("leaves paid, written-off, cancelled and already-discounted orders alone", () => {
    const orders = [
      order("keep", 100),
      order("paid", 100, { paid: true }),
      order("off", 100, { written_off: true }),
      order("gone", 100, { status: "cancelled" }),
      order("already", 100, { coupon_code: "OLD-ONE" }),
      order("mid-stripe", 100, { status: "pending_payment" }),
    ];
    expect(discountableOrders(orders).map(o => o.id)).toEqual(["keep"]);
  });
});

describe("spreading a discount across a table's orders", () => {
  it("splits by what each order is worth", () => {
    const shares = spreadDiscount([order("a", 200), order("b", 100)], 60);
    expect(shares.map(s => s.amount)).toEqual([40, 20]);
    expect(shares.map(s => s.total)).toEqual([160, 80]);
  });

  it("adds back to the discount, cent for cent", () => {
    const orders = [order("a", 33.33), order("b", 66.67)];
    const shares = spreadDiscount(orders, 17.77);
    const sum = shares.reduce((s, x) => s + x.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(17.77);
  });

  it("never takes more off a bill than the bill is worth", () => {
    const shares = spreadDiscount([order("a", 50)], 500);
    expect(shares[0].amount).toBe(50);
    expect(shares[0].total).toBe(0);
  });

  it("does nothing with nothing to discount", () => {
    expect(spreadDiscount([], 10)).toEqual([]);
    const none = spreadDiscount([order("a", 50)], 0);
    expect(none[0]).toEqual({ orderId: "a", amount: 0, total: 50 });
  });

  it("totals a bill across its orders", () => {
    expect(billTotal([order("a", 10.005), order("b", 10.005)])).toBe(20.01);
  });
});

describe("the bills the floor can still act on", () => {
  const at = (id: string, table: string | null, total: number, when: string, over = {}) => ({
    ...order(id, total, over),
    table_id: table,
    table_label: table,
    created_at: when,
    items: [{ itemId: "i", name: "Burger", emoji: "🍔", price: total, qty: 1, mods: {} }],
  });

  it("groups a table's orders into one bill and keeps to-go ones apart", () => {
    const bills = openBills([
      at("a", "4", 100, "2026-08-15T12:00:00Z"),
      at("b", "4", 50, "2026-08-15T12:20:00Z"),
      at("c", null, 80, "2026-08-15T12:10:00Z"),
    ]);
    expect(bills).toHaveLength(2);
    const table = bills.find(b => b.tableLabel === "4")!;
    expect(table.total).toBe(150);
    expect(table.orderIds).toHaveLength(2);
    expect(bills.find(b => b.tableId === null)!.code).toMatch(/^ORD-/);
  });

  it("puts the longest-waiting bill first", () => {
    const bills = openBills([
      at("late", "9", 10, "2026-08-15T13:00:00Z"),
      at("early", "1", 10, "2026-08-15T11:00:00Z"),
    ]);
    expect(bills.map(b => b.tableLabel)).toEqual(["1", "9"]);
  });

  it("flags a bill that already carries a promotion", () => {
    const [bill] = openBills([at("a", "2", 100, "2026-08-15T12:00:00Z", { coupon_code: "MEM-50X" })]);
    expect(bill.discounted).toBe(true);
  });

  it("finds a bill by table, by order code or by dish", () => {
    const [table] = openBills([at("a", "12", 100, "2026-08-15T12:00:00Z")]);
    expect(matchesBill(table, "12")).toBe(true);
    expect(matchesBill(table, "burger")).toBe(true);
    expect(matchesBill(table, "")).toBe(true);
    expect(matchesBill(table, "sushi")).toBe(false);
  });
});
