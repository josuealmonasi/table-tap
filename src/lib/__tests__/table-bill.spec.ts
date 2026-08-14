import { describe, expect, it } from "vitest";
import {
  canPayMineOnly,
  ordersToPay,
  tableBill,
  unpaidOrders,
} from "@/lib/table-bill";
import type { Order, OrderStatus } from "@/lib/types";

function order(
  id: string,
  total: number,
  opts: { paid?: boolean; status?: OrderStatus; items?: string[] } = {},
): Order {
  return {
    id,
    restaurant_id: "r1",
    table_id: "t1",
    table_label: "1",
    status: opts.status ?? "received",
    subtotal: total,
    service_fee: 0,
    tip: 0,
    tax_pct: 0,
    total,
    currency: "MXN",
    items: (opts.items ?? ["Taco"]).map(name => ({
      itemId: name,
      name,
      emoji: "🌮",
      price: total,
      qty: 1,
      mods: {},
    })),
    note: null,
    pay_method: null,
    paid: opts.paid ?? false,
    stripe_payment_intent: null,
    stripe_refund_id: null,
    created_at: "2026-08-13T12:00:00Z",
  };
}

describe("what a table owes", () => {
  it("counts only unpaid orders", () => {
    const orders = [order("a", 100), order("b", 50, { paid: true })];
    expect(unpaidOrders(orders).map(o => o.id)).toEqual(["a"]);
    expect(tableBill(orders, []).total).toBe(100);
  });

  it("does not charge for a cancelled order", () => {
    // Cancelled food was never served; it is not a debt.
    const orders = [order("a", 100), order("b", 80, { status: "cancelled" })];
    expect(tableBill(orders, []).total).toBe(100);
  });

  it("does not charge for an order already written off", () => {
    // The restaurant gave up on it; putting it back on a bill would ask
    // somebody to pay for food nobody is charging for.
    const orders = [order("a", 100), { ...order("b", 80), written_off: true }];
    expect(tableBill(orders, []).total).toBe(100);
    expect(unpaidOrders(orders).map(o => o.id)).toEqual(["a"]);
  });

  it("is settled when nothing is outstanding", () => {
    const bill = tableBill([order("a", 100, { paid: true })], ["a"]);
    expect(bill.settled).toBe(true);
    expect(bill.total).toBe(0);
  });
});

describe("mine versus the rest of the table", () => {
  const orders = [
    order("a", 185, { items: ["Tacos", "Agua"] }),
    order("b", 240, { items: ["Ribeye", "Cerveza"] }),
  ];

  it("splits by the orders this phone placed", () => {
    const bill = tableBill(orders, ["a"]);
    expect(bill.mine.total).toBe(185);
    expect(bill.others.total).toBe(240);
    expect(bill.total).toBe(425);
  });

  it("lists the lines on each side, for showing what is being paid for", () => {
    const bill = tableBill(orders, ["a"]);
    expect(bill.mine.items.map(i => i.name)).toEqual(["Tacos", "Agua"]);
    expect(bill.others.items.map(i => i.name)).toEqual(["Ribeye", "Cerveza"]);
  });

  it("treats a phone that ordered nothing as owing nothing, but still shows the table", () => {
    // Somebody who only scanned the QR can still settle for everyone.
    const bill = tableBill(orders, []);
    expect(bill.mine.total).toBe(0);
    expect(bill.total).toBe(425);
    expect(canPayMineOnly(bill)).toBe(false);
  });

  it("only offers 'pay mine' when somebody else is on the bill too", () => {
    expect(canPayMineOnly(tableBill(orders, ["a"]))).toBe(true);
    // Alone on the table, paying "mine" and paying "everything" are one act.
    expect(canPayMineOnly(tableBill([orders[0]], ["a"]))).toBe(false);
  });
});

describe("what a payment covers", () => {
  const orders = [order("a", 185), order("b", 240)];

  it("pays the whole table", () => {
    const bill = tableBill(orders, ["a"]);
    expect(ordersToPay(bill, "all").map(o => o.id).sort()).toEqual(["a", "b"]);
  });

  it("pays only this phone's orders", () => {
    const bill = tableBill(orders, ["a"]);
    expect(ordersToPay(bill, "mine").map(o => o.id)).toEqual(["a"]);
  });
});

describe("money", () => {
  it("rounds once at the end, so the total matches the sum of its parts", () => {
    const orders = [order("a", 10.005), order("b", 10.005)];
    const bill = tableBill(orders, ["a"]);
    expect(bill.total).toBe(round(bill.mine.total + bill.others.total));
  });
});

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
