import { describe, it, expect } from "vitest";
import { formatMoney } from "@/lib/format";
import { menuSlug } from "@/lib/slug";

describe("formatMoney", () => {
  it("shows two decimals", () => {
    expect(formatMoney(14.9, "USD")).toMatch(/14\.90/);
    expect(formatMoney(7, "MXN")).toMatch(/7\.00/);
  });

  it("includes a currency symbol", () => {
    expect(formatMoney(5, "USD")).toContain("$");
  });
});

describe("menuSlug", () => {
  it("lowercases and dashes non-alphanumerics", () => {
    expect(menuSlug("Weekend Brunch")).toBe("weekend-brunch");
    expect(menuSlug("Menu #1")).toBe("menu-1");
    expect(menuSlug("  Café del Sol!! ")).toBe("caf-del-sol");
  });

  it("falls back to 'menu' when nothing usable remains", () => {
    expect(menuSlug("")).toBe("menu");
    expect(menuSlug("!!!")).toBe("menu");
  });
});
