import { describe, expect, it } from "vitest";
import {
  DEFAULT_ICON_GROUPS,
  groupsFor,
  isEmoji,
  type StoredIconGroup,
} from "@/lib/icon-groups";

const stored = (over: Partial<StoredIconGroup> = {}): StoredIconGroup => ({
  id: "g1",
  variant: "addon",
  name: "Salsas de la casa",
  sort_order: 0,
  items: [{ emoji: "🌶️", label: "Picante", sort_order: 0 }],
  ...over,
});

describe("which icon groups a restaurant sees", () => {
  it("falls back to ours when it has none", () => {
    expect(groupsFor("addon")).toEqual(DEFAULT_ICON_GROUPS.addon);
  });

  it("puts its own first, and never hides ours", () => {
    // Theirs first because they made them to reach the ones they use daily;
    // ours stay because a picker that can end up empty is worse than a long one.
    const groups = groupsFor("addon", [stored()]);
    expect(groups[0].name).toBe("Salsas de la casa");
    expect(groups).toHaveLength(DEFAULT_ICON_GROUPS.addon.length + 1);
  });

  it("keeps the two palettes apart", () => {
    const groups = groupsFor("product", [stored({ variant: "addon" })]);
    expect(groups).toEqual(DEFAULT_ICON_GROUPS.product);
  });

  it("hides a group with nothing in it", () => {
    // An empty tab only disappoints whoever opens it.
    expect(groupsFor("addon", [stored({ items: [] })])).toEqual(DEFAULT_ICON_GROUPS.addon);
  });

  it("respects the order given to it", () => {
    const groups = groupsFor("addon", [
      stored({ id: "b", name: "Segundo", sort_order: 2 }),
      stored({ id: "a", name: "Primero", sort_order: 1 }),
    ]);
    expect(groups.slice(0, 2).map(g => g.name)).toEqual(["Primero", "Segundo"]);
  });
});

describe("what counts as an emoji", () => {
  it("takes one, and refuses a sentence", () => {
    for (const good of ["🌮", "🌶️", "🧄"]) expect(isEmoji(good)).toBe(true);
    for (const bad of ["", "   ", "taco", "<script>", "🌮🌮🌮🌮🌮"]) {
      expect(isEmoji(bad), bad).toBe(false);
    }
  });
});
