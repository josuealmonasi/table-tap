import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const sql = readFileSync("supabase/schema.sql", "utf8");
function body(name: string) {
  const start = sql.lastIndexOf(`create or replace function public.${name}(`);
  return sql.slice(start, sql.indexOf("\n$$;", start) + 4);
}
it("J6: a numeric recount advances the generation under the dish lock", () => {
  expect(body("recount_stock")).toContain("for update");
  expect(body("recount_stock")).toContain("stock_epoch = stock_epoch + 1");
  expect(body("stock_tracking_epoch")).toContain("new.stock is distinct from old.stock");
  // Each trusted movement marks itself inside its own body: Supabase refuses a
  // custom setting attached with ALTER FUNCTION ... SET, and the schema did not
  // apply until it moved.
  for (const fn of ["release_stock", "release_stock_reservation", "take_stock_floor", "record_waste"]) {
    expect(body(fn), fn).toContain("set_config('tabletap.stock_movement', 'on', true)");
  }
  const threeArg = sql.slice(sql.indexOf("create or replace function public.reserve_stock("));
  expect(threeArg.slice(0, threeArg.indexOf("$$;", threeArg.indexOf("$$") + 2))).toContain("set_config('tabletap.stock_movement', 'on', true)");
  expect(body("recount_stock")).toContain("set_config('tabletap.stock_recount', 'on', true)");
  expect(sql).not.toMatch(/alter function [^;]* set tabletap\./);
});
it("J7: cancellation and expiry cannot credit reconstructed legacy demand", () => {
  for (const fn of ["abandon_checkout", "cancel_order", "cancel_order_v2"]) {
    expect(body(fn)).not.toMatch(/perform release_stock\(/);
  }
  expect(body("order_stock_reservation")).toContain("stock=unproven");
});
