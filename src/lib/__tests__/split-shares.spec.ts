import { describe, expect, it } from "vitest";
import { MAX_SHARES, shareChoices } from "@/lib/split-shares";

describe("how many ways a table may divide its bill", () => {
  it("offers nothing to a diner sitting on their own", () => {
    // Mesa 10, in production. One phone had scanned the table, the screen
    // offered a split between 2 and 20, and the diner chose twelve. Eleven of
    // those shares could never be claimed by anybody — and until the proposal
    // was called off, nobody could pay the bill at all.
    expect(shareChoices(1)).toEqual([]);
    expect(shareChoices(0)).toEqual([]);
  });

  it("stops at the number of phones that are actually there", () => {
    // Four people, three of them scanned: two or three ways, not four.
    expect(shareChoices(3)).toEqual([2, 3]);
    expect(shareChoices(2)).toEqual([2]);
  });

  it("never goes past what the database allows", () => {
    // `bill_splits.shares` is checked between 2 and 20; a bus party of forty
    // must not produce a proposal the insert would reject.
    expect(shareChoices(40)).toHaveLength(MAX_SHARES - 1);
    expect(shareChoices(40).at(-1)).toBe(MAX_SHARES);
  });

  it("never offers one way, which is not a division", () => {
    for (const n of [0, 1, 2, 5, 20, 99]) {
      expect(shareChoices(n).includes(1)).toBe(false);
    }
  });

  it("is a contiguous run from two, so no count is missing", () => {
    expect(shareChoices(6)).toEqual([2, 3, 4, 5, 6]);
  });

  it("treats nonsense as nobody rather than throwing", () => {
    expect(shareChoices(-3)).toEqual([]);
  });
});
