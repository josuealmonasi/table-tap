import { describe, it, expect } from "vitest";
import { dietaryTags } from "@/lib/dietary";

describe("dietaryTags", () => {
  it("resolves known keys to tags, preserving order", () => {
    const tags = dietaryTags(["vegan", "spicy"]);
    expect(tags.map(t => t.key)).toEqual(["vegan", "spicy"]);
    expect(tags[0].label).toBe("Vegan");
    expect(tags[0].emoji).toBeTruthy();
  });

  it("drops unknown keys", () => {
    expect(dietaryTags(["vegan", "made-up"]).map(t => t.key)).toEqual(["vegan"]);
  });

  it("handles null, undefined and empty input", () => {
    expect(dietaryTags(null)).toEqual([]);
    expect(dietaryTags(undefined)).toEqual([]);
    expect(dietaryTags([])).toEqual([]);
  });
});
