import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { currentSection, DASHBOARD_PAGES } from "@/lib/nav";

const tabs = ["/dashboard", "/dashboard/orders", "/dashboard/pos", "/dashboard/analytics"];

describe("currentSection", () => {
  it("lights the longest matching tab", () => {
    expect(currentSection("/dashboard/orders", tabs)).toBe("/dashboard/orders");
    expect(currentSection("/dashboard/pos/receipt", tabs)).toBe("/dashboard/pos");
    expect(currentSection("/dashboard", tabs)).toBe("/dashboard");
  });

  it("gives a menu's own page to Menús", () => {
    expect(currentSection("/dashboard/main-menu", tabs)).toBe("/dashboard");
    expect(currentSection("/dashboard/brunch/items", tabs)).toBe("/dashboard");
  });

  it("lights nothing on a page without a tab (Ajustes lit Menús on the phone bar, 2026-11-11)", () => {
    for (const page of ["settings", "staff", "plan", "profile", "admin", "held-sales"]) {
      expect(currentSection(`/dashboard/${page}`, tabs)).toBeUndefined();
    }
  });

  it("knows every fixed page the app has", () => {
    const folders = readdirSync("src/app/dashboard", { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith("[")).map(d => d.name).sort();
    expect([...DASHBOARD_PAGES].sort()).toEqual(folders);
  });
});
