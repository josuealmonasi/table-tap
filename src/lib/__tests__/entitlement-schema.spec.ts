import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/schema.sql", "utf8");
const body = (name: string) => sql.match(new RegExp(`create or replace function public\\.${name}\\([^]*?end \\$\\$;`, "i"))?.[0] ?? "";

describe("entitlements at the database write boundary", () => {
  it("D6 serializes ceiling counts for tables, menus, dishes and staff", () => {
    expect(body("enforce_plan_limit")).toMatch(/for no key update/i);
    expect(body("enforce_plan_limit")).toContain("from staff");
    expect(sql).toMatch(/create trigger staff_plan_limit before insert or update/i);
  });
  it("D7 checks updates that increase counted dishes", () => {
    expect(sql).toMatch(/create trigger items_plan_limit before insert or update/i);
    expect(body("enforce_plan_limit")).toContain("old.is_addon");
    expect(body("enforce_plan_limit")).toContain("old.restaurant_id");
  });
  it("D8 freezes authenticated menu, dish and table writes including deletion", () => {
    for (const table of ["menus", "menu_items", "restaurant_tables"]) {
      expect(sql).toMatch(new RegExp(`before insert or update or delete on ${table}[^]*?enforce_dashboard_write`, "i"));
    }
    expect(body("enforce_dashboard_write")).toContain("auth.uid() is null");
    expect(body("enforce_dashboard_write")).toContain("tt_plan_frozen");
  });
  it("D9 resolves expired local trials in both ceiling and feature checks", () => {
    expect(sql).toContain("public.effective_restaurant_plan");
    expect(body("enforce_plan_feature")).toContain("public.effective_restaurant_plan");
    expect(sql.match(/create or replace function public\.plan_ceiling[^]*?\$\$;/)?.[0]).toContain("public.effective_restaurant_plan");
  });
  it("D13 removes reporting ceilings the plan screen never promised", () => {
    expect(sql).toContain("drop column if exists analytics_days");
    expect(sql).toContain("drop column if exists log_days");
  });
});
