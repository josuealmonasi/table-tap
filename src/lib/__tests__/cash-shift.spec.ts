import { describe, expect, it } from "vitest";
import { needsExplanation, shiftNote, type CashShift } from "@/lib/cash-shift";

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

describe("a shift's count", () => {
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
