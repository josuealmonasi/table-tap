import { describe, expect, it } from "vitest";
import { round2 } from "@/lib/money";
import { applyPayment, foodOrdered, isSettled, stillOwed, suggestEqual } from "@/lib/table-balance";

describe("what a table still owes", () => {
  it("subtracts the food, never the tip", () => {
    // The example that named this: 200 of food, paid 100 + 15% tip.
    expect(stillOwed([{ total: 200 }], [{ amount: 115, tip: 15 }])).toBe(100);
  });

  it("adds up across payments that tipped differently", () => {
    // 100 at 15%, then 50 at 10%, then 50 at 10% — 200 of food, 25 of tips.
    const paid = [
      { amount: 115, tip: 15 },
      { amount: 55, tip: 5 },
      { amount: 55, tip: 5 },
    ];
    expect(stillOwed([{ total: 215, tip: 15 }], paid)).toBe(0);
    expect(isSettled([{ total: 215, tip: 15 }], paid)).toBe(true);
    expect(paid.reduce((s, p) => s + p.tip, 0)).toBe(25);
  });

  it("is not settled while a centavo is missing", () => {
    expect(isSettled([{ total: 100 }], [{ amount: 99.99, tip: 0 }])).toBe(false);
    expect(stillOwed([{ total: 100 }], [{ amount: 99.99, tip: 0 }])).toBe(0.01);
  });

  it("never goes below nothing, however generous the tip", () => {
    expect(stillOwed([{ total: 50 }], [{ amount: 500, tip: 450 }])).toBe(0);
    expect(stillOwed([{ total: 50 }], [{ amount: 80, tip: 0 }])).toBe(0);
  });

  it("sums several orders on one sitting", () => {
    expect(stillOwed([{ total: 60 }, { total: 40 }], [])).toBe(100);
    expect(stillOwed([{ total: 60 }, { total: 40 }], [{ amount: 60, tip: 0 }])).toBe(40);
  });
});

describe("taking one payment", () => {
  it("never takes more food than is owed", () => {
    // A waiter typing 1000 for 100 must not leave the bill owing minus 900.
    expect(applyPayment(100, 1000, 0)).toEqual({ food: 100, tip: 0, amount: 100 });
  });

  it("lets the tip exceed what is left, because a tip is not the food", () => {
    expect(applyPayment(20, 20, 50)).toEqual({ food: 20, tip: 50, amount: 70 });
  });

  it("refuses a negative amount or a negative tip", () => {
    expect(applyPayment(100, -50, -10)).toEqual({ food: 0, tip: 0, amount: 0 });
  });

  it("treats a number that is not one as nothing", () => {
    expect(applyPayment(100, Number.NaN, Infinity)).toEqual({ food: 0, tip: 0, amount: 0 });
  });
});

describe("suggesting equal parts", () => {
  it("uses the app's own division, odd centavo on the first", () => {
    // Confirmed rather than invented: one convention across the app.
    expect(suggestEqual(10, 3)).toEqual([3.34, 3.33, 3.33]);
    expect(suggestEqual(100, 4)).toEqual([25, 25, 25, 25]);
  });

  it("adds back up to the bill", () => {
    for (const [owed, people] of [[10, 3], [99.99, 7], [200, 6]] as const) {
      const shares = suggestEqual(owed, people);
      const sum = shares.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - owed)).toBeLessThan(0.005);
    }
  });
});

describe("a tip lands on the order without moving the balance", () => {
  it("walks a MX$200 bill through three uneven payments", () => {
    // The convention this has to survive: a collected tip is added to BOTH
    // `orders.tip` and `orders.total`, the way settling a whole table already
    // does. Replayed step by step here, because the danger is the opposite of
    // obvious — the food owed grows by every tip and the table never reaches
    // zero, so the waiter keeps collecting.
    const order = { total: 200, tip: 0 };
    const paid: { amount: number; tip: number }[] = [];

    for (const [asked, tip] of [[100, 15], [50, 5], [50, 5]]) {
      const taken = applyPayment(stillOwed([order], paid), asked, tip);
      paid.push({ amount: taken.amount, tip: taken.tip });
      order.tip = round2(order.tip + taken.tip);
      order.total = round2(order.total + taken.tip);
    }

    // The numbers the spec asked for: 200 for the food, 15 + 5 + 5 of tips.
    expect(stillOwed([order], paid)).toBe(0);
    expect(isSettled([order], paid)).toBe(true);
    expect(order.tip).toBe(25);
    expect(foodOrdered([order])).toBe(200);
    expect(round2(paid.reduce((sum, p) => sum + p.amount, 0))).toBe(225);
  });

  it("counts the food of an order whose tip is already on it", () => {
    expect(foodOrdered([{ total: 115, tip: 15 }, { total: 40 }])).toBe(140);
  });
});
