import { describe, expect, it } from "vitest";
import { reindexAfterRemoval } from "@/lib/reindex";

/**
 * The bug this comes from: in the option-group editor a half-typed option was
 * remembered as `drafts[1]`. Deleting the group above it slid every group down
 * one, the draft stayed on key 1, and the text the person had typed into the
 * second group appeared under the third — and would have been added to it.
 */
describe("state keyed by row position", () => {
  it("slides later keys down and drops the removed one", () => {
    const drafts = { 0: "first", 1: "second", 2: "third" };
    expect(reindexAfterRemoval(drafts, 0)).toEqual({ 0: "second", 1: "third" });
    expect(reindexAfterRemoval(drafts, 1)).toEqual({ 0: "first", 1: "third" });
    expect(reindexAfterRemoval(drafts, 2)).toEqual({ 0: "first", 1: "second" });
  });

  it("leaves keys below the removal alone", () => {
    expect(reindexAfterRemoval({ 0: "keep", 5: "far" }, 3)).toEqual({ 0: "keep", 4: "far" });
  });

  it("is unbothered by an empty record or an index nothing is keyed to", () => {
    expect(reindexAfterRemoval({}, 0)).toEqual({});
    expect(reindexAfterRemoval({ 2: "only" }, 9)).toEqual({ 2: "only" });
  });
});
