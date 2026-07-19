import { describe, it, expect } from "vitest";
import { menuSlug } from "@/lib/slug";

describe("menuSlug", () => {
  it("lowercases and hyphenates words", () => {
    expect(menuSlug("Weekend Brunch")).toBe("weekend-brunch");
  });

  it("collapses runs of punctuation and spaces into a single hyphen", () => {
    expect(menuSlug("Tacos   &   Tequila!!!")).toBe("tacos-tequila");
  });

  it("trims leading and trailing separators", () => {
    expect(menuSlug("  --Happy Hour--  ")).toBe("happy-hour");
  });

  it("drops accented and non-ascii characters", () => {
    // á and ñ aren't in [a-z0-9], so they become separators.
    expect(menuSlug("Café Niño")).toBe("caf-ni-o");
  });

  it("keeps digits", () => {
    expect(menuSlug("Menu 2 for 1")).toBe("menu-2-for-1");
  });

  it("falls back to 'menu' when nothing usable remains", () => {
    expect(menuSlug("")).toBe("menu");
    expect(menuSlug("   ")).toBe("menu");
    expect(menuSlug("!!!")).toBe("menu");
    expect(menuSlug("🍔🍟")).toBe("menu");
  });
});
