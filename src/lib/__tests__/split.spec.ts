import { describe, expect, it } from "vitest";
import { sharesFor } from "@/lib/split";

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
        const cents = sharesFor(amount, people).reduce((sum, share) => sum + Math.round(share * 100), 0);
        expect(cents).toBe(Math.round(amount * 100));
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
