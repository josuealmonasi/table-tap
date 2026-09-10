import { describe, expect, it } from "vitest";
import { round2 } from "@/lib/money";
import { applyPayment, billTotal, isSettled, stillOwed, suggestEqual } from "@/lib/table-balance";

describe("what a table still owes", () => {
  it("is what the orders come to, less what has been paid", () => {
    expect(stillOwed([{ total: 200 }], [{ amount: 115, tip: 15 }])).toBe(85);
    expect(billTotal([{ total: 60 }, { total: 40 }])).toBe(100);
  });

  it("still owes a gratuity the diner committed to and nobody collected", () => {
    // The bug this replaced: an unpaid order carrying a MX$0.90 tip read as
    // MX$93.17 of food, and the table closed ninety centavos light. What is
    // owed is the order's total, whatever the total is made of.
    expect(stillOwed([{ total: 94.07 }], [])).toBe(94.07);
  });

  it("is not settled while a centavo is missing", () => {
    expect(isSettled([{ total: 100 }], [{ amount: 99.99, tip: 0 }])).toBe(false);
    expect(stillOwed([{ total: 100 }], [{ amount: 99.99, tip: 0 }])).toBe(0.01);
  });

  it("never goes below nothing, however generous the payment", () => {
    expect(stillOwed([{ total: 50 }], [{ amount: 500, tip: 450 }])).toBe(0);
  });

  it("sums several orders on one sitting", () => {
    expect(stillOwed([{ total: 60 }, { total: 40 }], [{ amount: 60, tip: 0 }])).toBe(40);
  });
});

describe("taking one payment", () => {
  it("never takes more than is owed", () => {
    // A waiter typing 1000 for 100 must not leave the bill owing minus 900.
    expect(applyPayment(100, 1000, 0)).toEqual({ food: 100, tip: 0, amount: 100 });
  });

  it("caps the tip at the food it is thanking somebody for", () => {
    // The ceiling every other tip in the app has: `tipFor` clamps a percentage
    // at 100, and the two routes that charge a card clamp an exact amount at
    // what is payable. A mistyped MX$50 on a MX$20 collection is cash the
    // waiter would have to account for at the count.
    expect(applyPayment(20, 20, 50)).toEqual({ food: 20, tip: 20, amount: 40 });
    expect(applyPayment(100, 50, 7.5)).toEqual({ food: 50, tip: 7.5, amount: 57.5 });
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

describe("a gratuity lands on the order without moving the balance", () => {
  it("walks a MX$200 bill through three uneven payments", () => {
    // The convention this has to survive: a collected tip is added to BOTH
    // `orders.tip` and `orders.total`, the way settling a whole table already
    // does. Replayed step by step, because it appears on both sides of the
    // subtraction at once and it is not obvious that it cancels.
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
    expect(round2(paid.reduce((sum, p) => sum + p.amount, 0))).toBe(225);
  });

  it("leaves the bill exactly as short as the food not yet handed over", () => {
    // Halfway through the same table: 115 in, of which 15 was a tip, so the
    // order is 215 and 100 of food is still to come.
    const order = { total: 215 };
    expect(stillOwed([order], [{ amount: 115, tip: 15 }])).toBe(100);
  });
});
