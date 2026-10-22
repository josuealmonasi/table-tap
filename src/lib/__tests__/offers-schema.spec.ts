import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const sql = readFileSync("supabase/schema.sql", "utf8");
const fn = (name: string) => sql.match(new RegExp(`create or replace function public\\.${name}\\([^]*?end \\$\\$;`, "i"))?.[0] ?? "";
it("J2 replaces a scoped promotion and all its components without catching failed writes", () => {
  const body = fn("save_promotion_v1");
  expect(body).toContain("restaurant_id = p_restaurant");
  expect(body).toContain("delete from promotion_items");
  expect(body).toContain("insert into promotion_items");
  expect(body).toContain("for update");
  expect(body).not.toMatch(/exception when/i);
});
it("J16 protects both offers and their components against direct frozen writes", () => {
  for (const table of ["promotions", "promotion_items", "coupons"]) {
    expect(sql).toMatch(new RegExp(`before insert or update or delete on ${table}[^]*?enforce_offer_write`, "i"));
  }
  expect(fn("enforce_offer_write")).toContain("to_jsonb(new) - 'active'");
  expect(fn("enforce_offer_write")).toContain("tt_plan_frozen");
});
it("J14 copies every menu setting and link, starts hidden, and publishes last", () => {
  const body = fn("duplicate_menu_v1");
  for (const field of ["schedule", "station", "price", "discount_pct", "dietary", "skips_kitchen", "modifiers", "image_url"]) {
    expect(body).toContain(field);
  }
  expect(body).toContain("false, v_source.schedule");
  expect(body.indexOf("update menus set active")).toBeGreaterThan(body.indexOf("insert into item_addons"));
  expect(body).toContain("stock, stock_auto_off");
  expect(body).toContain("null, false");
  expect(body).not.toMatch(/exception when/i);
});
it("new RPCs are private to the server and have reset parity", () => {
  const drop = readFileSync("supabase/drop.sql", "utf8");
  for (const name of ["save_promotion_v1", "duplicate_menu_v1", "enforce_offer_write"]) {
    expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}[^;]*from public, anon, authenticated`));
    expect(drop).toContain(`public.${name}(`);
  }
});
