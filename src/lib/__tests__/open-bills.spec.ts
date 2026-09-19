import { describe, expect, it } from "vitest";
import { matchesBill, openBills, withCollected, withSplits } from "@/lib/open-bills";
import type { Order } from "@/lib/types";

/**
 * 142 lines of bill grouping with no test of its own until now. It decides
 * what the floor is shown as owing, which is the number somebody collects
 * against.
 */
const order = (over: Partial<Order> = {}): Order =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    restaurant_id: "r",
    table_id: null,
    table_label: null,
    customer_name: null,
    items: [{ itemId: "d1", name: "Tacos", emoji: "🌮", price: 50, qty: 1, mods: {} }],
    total: 50,
    discount: 0,
    coupon_code: null,
    paid: false,
    written_off: false,
    status: "received",
    created_at: "2026-09-18T10:00:00.000Z",
    session_id: null,
    ...over,
  }) as unknown as Order;

describe("a table is one bill and a to-go order is its own", () => {
  it("adds up every order on a table", () => {
    const bills = openBills([
      order({ id: "a1111111-1111-4111-8111-111111111111", table_id: "t1", table_label: "4", total: 60 }),
      order({ id: "a2222222-2222-4222-8222-222222222222", table_id: "t1", table_label: "4", total: 40 }),
    ]);
    expect(bills).toHaveLength(1);
    expect(bills[0].total).toBe(100);
    expect(bills[0].orderIds).toHaveLength(2);
    expect(bills[0].items).toHaveLength(2);
  });

  it("keeps to-go orders apart, each with its own code", () => {
    const bills = openBills([
      order({ id: "a1111111-1111-4111-8111-111111111111" }),
      order({ id: "b2222222-2222-4222-8222-222222222222" }),
    ]);
    expect(bills).toHaveLength(2);
    expect(bills.map(b => b.code)).toEqual(["ORD-A111", "ORD-B222"]);
  });

  it("shows the longest wait first, because that is the one being asked about", () => {
    const bills = openBills([
      order({ id: "a1111111-1111-4111-8111-111111111111", created_at: "2026-09-18T12:00:00.000Z" }),
      order({ id: "b2222222-2222-4222-8222-222222222222", created_at: "2026-09-18T09:00:00.000Z" }),
    ]);
    expect(bills[0].code).toBe("ORD-B222");
  });

  it("dates a table by its FIRST order, not whichever arrived last", () => {
    const bills = openBills([
      order({ id: "a1111111-1111-4111-8111-111111111111", table_id: "t1", created_at: "2026-09-18T12:00:00.000Z" }),
      order({ id: "a2222222-2222-4222-8222-222222222222", table_id: "t1", created_at: "2026-09-18T09:00:00.000Z" }),
    ]);
    expect(bills[0].since).toBe("2026-09-18T09:00:00.000Z");
  });

  it("adds the discounts up and remembers one was already given", () => {
    const bills = openBills([
      order({ id: "a1111111-1111-4111-8111-111111111111", table_id: "t1", total: 90, discount: 10 }),
      order({ id: "a2222222-2222-4222-8222-222222222222", table_id: "t1", total: 45, discount: 5, coupon_code: "HOL-A50" }),
    ]);
    expect(bills[0].discount).toBe(15);
    // A second promotion would take the same money off twice.
    expect(bills[0].discounted).toBe(true);
  });

  it("rounds money as it accumulates, not at the end", () => {
    const bills = openBills([
      order({ id: "a1111111-1111-4111-8111-111111111111", table_id: "t1", total: 0.1 }),
      order({ id: "a2222222-2222-4222-8222-222222222222", table_id: "t1", total: 0.2 }),
    ]);
    expect(bills[0].total).toBe(0.3);
  });

  it("leaves out what is already paid or written off", () => {
    expect(openBills([order({ paid: true })])).toHaveLength(0);
    expect(openBills([order({ written_off: true })])).toHaveLength(0);
  });
});

describe("what a sitting has already handed over", () => {
  it("marks the bill with it, so nobody collects that half twice", () => {
    const bills = openBills([order({ id: "a1111111-1111-4111-8111-111111111111", table_id: "t1", total: 200 })]);
    const withIt = withCollected(
      bills,
      new Map([["s1", 100]]),
      new Map([["a1111111-1111-4111-8111-111111111111", "s1"]]),
    );
    expect(withIt[0].collected).toBe(100);
  });

  it("leaves a bill alone when nothing has been collected on it", () => {
    const bills = openBills([order({ id: "a1111111-1111-4111-8111-111111111111", table_id: "t1" })]);
    expect(withCollected(bills, new Map(), new Map())[0].collected).toBeUndefined();
    // And a recorded zero is still nothing — it must not read as "paid some".
    const zero = withCollected(bills, new Map([["s1", 0]]), new Map([["a1111111-1111-4111-8111-111111111111", "s1"]]));
    expect(zero[0].collected).toBeUndefined();
  });

  it("finds the sitting through whichever of the bill's orders is on one", () => {
    const bills = openBills([
      order({ id: "a1111111-1111-4111-8111-111111111111", table_id: "t1", total: 50 }),
      order({ id: "a2222222-2222-4222-8222-222222222222", table_id: "t1", total: 50 }),
    ]);
    // Only the second order carries the sitting.
    const withIt = withCollected(bills, new Map([["s1", 30]]), new Map([["a2222222-2222-4222-8222-222222222222", "s1"]]));
    expect(withIt[0].collected).toBe(30);
  });
});

describe("a table part-way through dividing its bill", () => {
  it("carries how far it has got", () => {
    const bills = openBills([order({ id: "a1111111-1111-4111-8111-111111111111", table_id: "t1" })]);
    const withIt = withSplits(
      bills,
      [{ session_id: "s1", shares: 4, paidShares: 1 }],
      new Map([["a1111111-1111-4111-8111-111111111111", "s1"]]),
    );
    expect(withIt[0].split).toEqual({ shares: 4, paidShares: 1 });
  });

  it("says nothing about a table that is not dividing one", () => {
    const bills = openBills([order({ id: "a1111111-1111-4111-8111-111111111111", table_id: "t1" })]);
    expect(withSplits(bills, [], new Map())[0].split).toBeUndefined();
  });
});

describe("finding a bill the way the floor asks for it", () => {
  const bill = openBills([
    order({ id: "a1111111-1111-4111-8111-111111111111", table_label: "12", customer_name: "Ana María" }),
  ])[0];

  it("matches the table, the code, the name and the food", () => {
    expect(matchesBill(bill, "12")).toBe(true);
    expect(matchesBill(bill, "ord-a111")).toBe(true);
    expect(matchesBill(bill, "ana")).toBe(true);
    expect(matchesBill(bill, "TACOS")).toBe(true);
  });

  it("shows everything when nobody has typed anything", () => {
    expect(matchesBill(bill, "")).toBe(true);
    expect(matchesBill(bill, "   ")).toBe(true);
  });

  it("does not match what is not there", () => {
    expect(matchesBill(bill, "sushi")).toBe(false);
  });
});
