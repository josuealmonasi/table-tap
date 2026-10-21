import { describe, expect, it } from "vitest";
import { needsExplanation, shiftDifference, shiftNote, shiftSum, type CashShift } from "@/lib/cash-shift";

/**
 * A shift at the cash drawer: what it should hold, and what its count says.
 * Asked for by a café: open and close per shift, a blind count, and every
 * difference explained.
 */

const shift = (over: Partial<CashShift> = {}): CashShift => ({
  id: "s1", currency: "MXN", opened_by: "caja@x.dev", opened_at: "2026-10-14T13:00:00Z", opening_amount: 250,
  closed_by: null, closed_at: null, counted_cash: null, expected_cash: null, difference: null,
  difference_note: null, explained_by: null, ...over,
});

describe("what a shift's drawer should hold", () => {
  it("is the opening, plus the cash taken, minus what was taken out", () => {
    const sum = shiftSum(
      250,
      [
        { actor_email: "caja@x.dev", amount: 300, method: "cash" },
        { actor_email: "caja@x.dev", amount: 90, method: "card" },
        // Paid online: no drawer.
        { actor_email: null, amount: 500, method: "card" },
      ],
      [],
      [{ amount: 120 }],
    );
    expect(sum).toEqual({ opening: 250, cashSales: 300, withdrawn: 120, expected: 430 });
  });

  it("takes out cash handed back from the drawer that took it", () => {
    const sum = shiftSum(
      100,
      [{ actor_email: "caja@x.dev", amount: 80, method: "cash" }],
      [{ action: "refunded", detail: "amount=30 method=cash collector=caja@x.dev" }],
      [],
    );
    expect(sum.cashSales).toBe(50);
    expect(sum.expected).toBe(150);
  });
});

describe("a shift's count", () => {
  it("is over when there is more, short when there is less, to the cent", () => {
    expect(shiftDifference(1000, 1250.5)).toBe(-250.5);
    expect(shiftDifference(430.1, 430)).toBe(0.1);
    expect(shiftDifference(0.3, 0.1 + 0.2)).toBe(0);
  });

  it("owes an explanation only when closed with a difference nobody explained", () => {
    expect(needsExplanation(shift())).toBe(false);
    expect(needsExplanation(shift({ closed_at: "x", closed_by: "y", counted_cash: 250, difference: 0 }))).toBe(false);
    expect(needsExplanation(shift({ closed_at: "x", closed_by: "y", counted_cash: 230, difference: -20 }))).toBe(true);
    expect(needsExplanation(shift({ closed_at: "x", closed_by: "y", counted_cash: 230, difference: -20, difference_note: "cambio" }))).toBe(false);
  });

  it("keeps an explanation short, and drops an empty one", () => {
    expect(shiftNote("  di cambio de más  ")).toBe("di cambio de más");
    expect(shiftNote(" ")).toBeNull();
    expect(shiftNote("x".repeat(400))).toHaveLength(280);
  });
});
