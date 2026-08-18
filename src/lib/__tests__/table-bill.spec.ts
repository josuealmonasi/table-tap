import { describe, expect, it } from "vitest";
import {
  canPayMineOnly,
  openTables,
  ordersToPay,
  tableBill,
  unpaidOrders,
} from "@/lib/table-bill";
import { applyCoupon } from "@/lib/pricing";
import type { Order, OrderStatus } from "@/lib/types";

function order(
  id: string,
  total: number,
  opts: {
    paid?: boolean;
    status?: OrderStatus;
    items?: string[];
    discount?: number;
  } = {},
): Order {
  return {
    id,
    restaurant_id: "r1",
    table_id: "t1",
    table_label: "1",
    status: opts.status ?? "received",
    subtotal: total,
    discount: opts.discount ?? 0,
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

describe("which tables owe money", () => {
  const at = (id: string, table: string | null, total: number, when: string, paid = false) => ({
    ...order(id, total, { paid }),
    table_id: table,
    table_label: table,
    created_at: when,
  });

  it("groups a table's unpaid orders into one debt", () => {
    const rows = [
      at("a", "t1", 100, "2026-08-13T12:00:00Z"),
      at("b", "t1", 50, "2026-08-13T12:30:00Z"),
    ];
    const [table] = openTables(rows);
    expect(table.total).toBe(150);
    expect(table.orderCount).toBe(2);
  });

  it("dates a table by its oldest unpaid order, not its newest", () => {
    // How long they have been sitting on the debt is the useful number.
    const rows = [
      at("a", "t1", 100, "2026-08-13T12:30:00Z"),
      at("b", "t1", 50, "2026-08-13T12:00:00Z"),
    ];
    expect(openTables(rows)[0].since).toBe("2026-08-13T12:00:00Z");
  });

  it("lists the longest-waiting table first", () => {
    const rows = [
      at("a", "t2", 10, "2026-08-13T13:00:00Z"),
      at("b", "t1", 10, "2026-08-13T11:00:00Z"),
    ];
    expect(openTables(rows).map(t => t.tableId)).toEqual(["t1", "t2"]);
  });

  it("ignores paid tables and orders with no table at all", () => {
    // A fast-food QR pays before the kitchen sees it, so an unpaid one is a
    // cart mid-Stripe rather than a debt anyone can collect.
    const rows = [
      at("a", "t1", 100, "2026-08-13T12:00:00Z", true),
      at("b", null, 80, "2026-08-13T12:00:00Z"),
    ];
    expect(openTables(rows)).toEqual([]);
  });
});

describe("a coupon on a shared bill", () => {
  const coupon = { code: "GET-10X", kind: "percent" as const, value: 10 };

  it("discounts only the share being paid, so two diners can each use one", () => {
    const bill = tableBill([order("a", 200), order("b", 300)], ["a"]);
    // Mine is 200, so my 10% is 20 — the other diner's 300 is untouched and
    // their own code works the same way against their own food.
    expect(applyCoupon(coupon, bill.mine.total)).toBe(20);
    expect(applyCoupon(coupon, bill.others.total)).toBe(30);
  });

  it("never takes off more than the food is worth", () => {
    expect(applyCoupon({ code: "BIG-ONE", kind: "fixed", value: 500 }, 120)).toBe(120);
  });

  it("does nothing below the coupon's minimum spend", () => {
    const min = { ...coupon, minSubtotal: 300 };
    expect(applyCoupon(min, 200)).toBe(0);
    expect(applyCoupon(min, 300)).toBe(30);
  });

  it("marks orders that were already discounted when they were placed", () => {
    // Those totals already carry a discount; a second code would take the same
    // money off twice, so the bill hides the box and the server refuses.
    const bill = tableBill([{ ...order("a", 200), coupon_code: "OLD-ONE" }], ["a"]);
    expect(ordersToPay(bill, "all").some(o => o.coupon_code)).toBe(true);
  });
});

describe("a discount already on the bill", () => {
  it("is carried per side and for the table", () => {
    // The lines add up to more than the total. Without the amount, the diner
    // sees the difference and has nothing to explain it.
    const orders = [
      order("a", 6, { discount: 5 }),
      order("b", 20, { discount: 0 }),
    ];
    const bill = tableBill(orders, ["a"]);
    expect(bill.mine.discount).toBe(5);
    expect(bill.others.discount).toBe(0);
    expect(bill.discount).toBe(5);
  });

  it("adds up across several discounted orders without drifting a cent", () => {
    const orders = [
      order("a", 6.33, { discount: 1.72 }),
      order("b", 9.11, { discount: 2.89 }),
    ];
    expect(tableBill(orders, []).discount).toBe(4.61);
  });

  it("reads as zero when nothing was taken off", () => {
    expect(tableBill([order("a", 100)], []).discount).toBe(0);
  });

  it("ignores what a settled order was discounted", () => {
    // Paid and written-off orders are not owed, so their promotions are not
    // part of what this table is being asked to pay.
    const orders = [order("a", 6, { discount: 5, paid: true }), order("b", 20)];
    expect(tableBill(orders, []).discount).toBe(0);
  });
});
