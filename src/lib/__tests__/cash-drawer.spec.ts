import { describe, expect, it } from "vitest";
import { cashAmount, cashNote, pendingWithdrawn, withdrawalCounts } from "@/lib/cash-drawer";

/**
 * Asked for by a restaurant: "if we start the day with 250 pesos, the close is
 * the opening plus what was sold, and a withdrawal has to be recorded."
 */

describe("an amount of cash as typed", () => {
  it("reads whole pesos, cents and thousands separators", () => {
    expect(cashAmount("250", false)).toBe(250);
    expect(cashAmount("250.5", false)).toBe(250.5);
    expect(cashAmount(" 1,250.00 ", false)).toBe(1250);
    expect(cashAmount(99.99, true)).toBe(99.99);
  });

  it("refuses what is not one", () => {
    for (const bad of ["", "-5", "2.505", "abc", "1e3", null, undefined, "2000000"]) expect(cashAmount(bad, false)).toBeNull();
  });

  it("allows an empty drawer to start the day, but no withdrawal of nothing", () => {
    expect(cashAmount("0", false)).toBe(0);
    expect(cashAmount("0", true)).toBeNull();
  });

  it("keeps a reason short, and drops an empty one", () => {
    expect(cashNote("  proveedor  ")).toBe("proveedor");
    expect(cashNote("   ")).toBeNull();
    expect(cashNote("x".repeat(200))).toHaveLength(140);
  });
});

describe("a cashier's withdrawal awaiting approval (2026-11-25)", () => {
  it("counts as cash out only once approved; rows from before approval count as before", () => {
    expect(withdrawalCounts({ status: "approved" })).toBe(true);
    expect(withdrawalCounts({})).toBe(true);
    expect(withdrawalCounts({ status: "pending" })).toBe(false);
    expect(withdrawalCounts({ status: "rejected" })).toBe(false);
  });

  it("sums only what still waits for a manager, to the cent", () => {
    expect(pendingWithdrawn([
      { status: "pending", amount: 60.1 }, { status: "pending", amount: 0.2 },
      { status: "approved", amount: 40 }, { status: "rejected", amount: 5 }, { amount: 7 },
    ])).toBe(60.3);
    expect(pendingWithdrawn([])).toBe(0);
  });
});
