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
  for (const signature of ["reserve_stock(uuid, jsonb, int)", "release_stock(uuid, jsonb)",
    "release_stock_reservation(uuid, uuid)", "take_stock_floor(uuid, jsonb)", "record_waste(uuid, uuid, uuid, numeric, text, text, numeric, text)"]) {
    expect(sql).toContain(`alter function public.${signature} set tabletap.stock_movement = 'on'`);
  }
});
it("J7: cancellation and expiry cannot credit reconstructed legacy demand", () => {
  for (const fn of ["abandon_checkout", "cancel_order", "cancel_order_v2"]) {
    expect(body(fn)).not.toMatch(/perform release_stock\(/);
  }
  expect(body("order_stock_reservation")).toContain("stock=unproven");
});
