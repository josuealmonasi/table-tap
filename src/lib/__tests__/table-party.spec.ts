import { describe, expect, it } from "vitest";
import { diningOn, splitCeiling } from "@/lib/table-party";
import { MAX_SHARES, shareChoices } from "@/lib/split-shares";

const from = (...diners: (string | null)[]) => diners.map(diner => ({ diner }));

describe("how many people a table's bill is made of", () => {
  it("counts devices, not orders", () => {
    // One person ordering three rounds is one person, and a bill divided three
    // ways would leave two shares nobody could claim.
    expect(diningOn(from("a", "a", "a"))).toBe(1);
  });

  it("counts everyone who ordered, however much they ordered", () => {
    expect(diningOn(from("a", "b", "b", "c"))).toBe(3);
  });

  it("counts a waiter's orders as one party between them", () => {
    // Typed at the POS, so there is no device behind them. Four rounds a
    // waiter entered is not four people — but the table is certainly somebody.
    expect(diningOn(from(null, null, null))).toBe(1);
    expect(diningOn(from("a", null))).toBe(2);
  });

  it("gives a table nobody has ordered at nothing to divide", () => {
    expect(diningOn([])).toBe(0);
    expect(shareChoices(splitCeiling([]))).toEqual([]);
  });

  it("refuses to divide a bill one person is eating", () => {
    // Mesa 10: one phone, a split proposed twelve ways, and a bill nobody
    // could pay until the proposal was called off.
    expect(shareChoices(splitCeiling(from("a")))).toEqual([]);
  });

  it("stops at the people who ordered, not the people at the table", () => {
    // Nineteen sitting down, ten of them ordering: ten ways, not nineteen.
    const ten = from(..."abcdefghij".split(""));
    expect(splitCeiling(ten)).toBe(10);
    expect(shareChoices(splitCeiling(ten))).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("never goes past what the database allows", () => {
    // `bill_splits.shares` is checked between 2 and 20 — a coach party must not
    // produce a proposal the insert would reject.
    const many = from(...Array.from({ length: 31 }, (_, i) => `d${i}`));
    expect(splitCeiling(many)).toBe(MAX_SHARES);
  });
});
