import { describe, expect, it } from "vitest";
import { addsUp, amountToSplit, sharesFor, splitTotals } from "@/lib/split";

describe("dividing a bill", () => {
  it("splits what divides cleanly", () => {
    expect(sharesFor(90, 3)).toEqual([30, 30, 30]);
    expect(sharesFor(10, 2)).toEqual([5, 5]);
  });

  it("gives the odd cent to whoever asked", () => {
    // The case from the ask: 10 between 3.
    expect(sharesFor(10, 3)).toEqual([3.34, 3.33, 3.33]);
    expect(sharesFor(100, 3)).toEqual([33.34, 33.33, 33.33]);
    expect(sharesFor(0.1, 3)).toEqual([0.04, 0.03, 0.03]);
  });

  it("always adds back up to the bill", () => {
    // A table will notice a bill that does not sum to itself before it notices
    // anything else, so this is checked across the awkward numbers rather than
    // trusted from one example.
    for (const amount of [10, 33.33, 0.03, 999.99, 1234.56, 0.07]) {
      for (const people of [2, 3, 4, 5, 6, 7, 8]) {
        expect(addsUp(amount, sharesFor(amount, people))).toBe(true);
      }
    }
  });

  it("has nothing to divide when nothing is owed", () => {
    expect(sharesFor(0, 4)).toEqual([0, 0, 0, 0]);
    expect(sharesFor(-5, 3)).toEqual([0, 0, 0]);
  });

  it("refuses a nonsense number of people", () => {
    expect(sharesFor(10, 0)).toEqual([]);
    expect(sharesFor(10, -2)).toEqual([]);
    expect(sharesFor(10, 2.5)).toEqual([]);
  });
});

describe("what is left to divide", () => {
  it("leaves out what someone already paid for themselves", () => {
    // Somebody settles their own dishes and leaves early; the rest divide the
    // remainder, not the whole bill again.
    expect(amountToSplit(300, 100)).toBe(200);
  });

  it("never goes below nothing", () => {
    expect(amountToSplit(50, 80)).toBe(0);
  });

  it("is the whole bill when nobody has paid", () => {
    expect(amountToSplit(240.5, 0)).toBe(240.5);
  });
});

describe("what each person actually pays", () => {
  it("adds what they ordered after the table agreed", () => {
    // The rule: the split freezes. A beer bought afterwards is yours.
    const totals = splitTotals(30, 3, [5, 0, 0]);
    expect(totals[0]).toEqual({ share: 10, own: 5, total: 15 });
    expect(totals[1]).toEqual({ share: 10, own: 0, total: 10 });
  });

  it("keeps the odd cent with the proposer even when they order more", () => {
    const totals = splitTotals(10, 3, [5, 0, 0]);
    expect(totals[0]).toEqual({ share: 3.34, own: 5, total: 8.34 });
    expect(totals[1].share).toBe(3.33);
  });

  it("treats a missing later order as nothing", () => {
    expect(splitTotals(30, 3).map(s => s.total)).toEqual([10, 10, 10]);
  });
});
