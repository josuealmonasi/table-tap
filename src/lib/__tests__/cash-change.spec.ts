import { describe, expect, it } from "vitest";
import { cashSuggestions, changeFor } from "@/lib/cash-change";

describe("change for cash", () => {
  it("gives back what was handed over above the amount owed", () => {
    expect(changeFor(187.5, 200)).toEqual({ change: 12.5, short: 0 });
    expect(changeFor(187.5, 187.5)).toEqual({ change: 0, short: 0 });
    expect(changeFor(0.3, 0.1 + 0.2)).toEqual({ change: 0, short: 0 }); // no floating-point cents
  });
  it("says how much is still missing when it is not enough", () => {
    expect(changeFor(187.5, 150)).toEqual({ change: 0, short: 37.5 });
  });
  it.each([
    ["MXN", 187.5, [200, 500, 1000]],
    ["MXN", 45, [50, 60, 100, 200]],
    ["MXN", 200, [500, 1000]], // the exact amount is its own chip
    ["USD", 18.4, [19, 20, 50, 100]],
  ])("suggests the notes a %s diner is likely to hand over for %s", (currency, amount, expected) => {
    expect(cashSuggestions(amount as number, currency as string)).toEqual(expected);
  });
  it("suggests nothing for nothing owed", () => {
    expect(cashSuggestions(0, "MXN")).toEqual([]);
  });
});
