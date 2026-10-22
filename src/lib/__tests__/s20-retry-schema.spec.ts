import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const schema = readFileSync("supabase/schema.sql", "utf8").split("-- S20:")[1];
const drop = readFileSync("supabase/drop.sql", "utf8");
const fn = (name: string) => schema.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0] ?? "";
it("K4 the transaction checks the saved order before stock or a coupon, and rolls back competing claims", () => {
  const sql = fn("create_order_intent");
  expect(sql.indexOf("lock_restaurant_money")).toBeLessThan(sql.indexOf("order_intent_result"));
  expect(sql.indexOf("order_intent_result")).toBeLessThan(sql.indexOf("public.reserve_stock"));
  expect(sql.indexOf("order_intent_result")).toBeLessThan(sql.indexOf("public.redeem_coupon"));
  expect(sql).toContain("on conflict (restaurant_id, request_ref) where request_ref is not null do nothing");
  expect(sql).toContain("when sqlstate 'PT021' then return public.order_intent_result");
  expect(sql).toContain("insert into coupon_redemptions");
  expect(fn("order_intent_result")).toContain("o.request_scope is distinct from p_scope");
});
it("K5 withdrawals return a previous movement before checking whether its shift is still open", () => {
  const sql = fn("create_cash_withdrawal_once");
  expect(sql.indexOf("lock_restaurant_money")).toBeLessThan(sql.indexOf("select * into m"));
  expect(sql.indexOf("if found then return")).toBeLessThan(sql.indexOf("closed_at is null for update"));
  expect(sql).toContain("on conflict (shift_id, request_ref)");
});
it("K6 ingredient retries keep the movement-first lock order and return before any new baseline or price", () => {
  for (const [name, write] of [["record_purchase_once", "insert into ingredient_purchases"], ["record_waste_once", "insert into waste_entries"], ["record_ingredient_counts_once", "insert into ingredient_counts"]]) {
    const sql = fn(name);
    expect(sql.indexOf("lock_ingredient_movements")).toBeLessThan(sql.indexOf(write));
    expect(sql.indexOf("if found then return") >= 0 || sql.indexOf("if v_results is not null then return") >= 0).toBe(true);
    expect(sql).toContain("on conflict");
  }
  expect(fn("record_purchase_once").indexOf("lock_ingredient_movements")).toBeLessThan(fn("record_purchase_once").indexOf("for update"));
  const waste = fn("record_waste_once");
  expect(waste.indexOf("lock_ingredient_movements")).toBeLessThan(waste.indexOf("select name into v_name from ingredients"));
  expect(fn("record_ingredient_counts_once")).toContain("'movement_cutoff', movement_cutoff");
});
it("K9 a saved close is returned before calling the original locked closer on the named shift", () => {
  const sql = fn("close_cash_shift_once");
  expect(sql.indexOf("lock_restaurant_money")).toBeLessThan(sql.indexOf("close_ref = p_ref"));
  expect(sql).toContain("if s.id = p_shift then return s.close_result");
  expect(sql).toContain("public.close_cash_shift(p_restaurant, p_shift, p_counted, p_actor)");
  expect(sql).toContain("close_result = v_result");
});
it("all new helpers stay service-only, resettable, and all new references leave legacy rows nullable", () => {
  for (const name of ["order_intent_result", "create_order_intent", "create_cash_withdrawal_once", "record_purchase_once", "record_waste_once", "record_ingredient_counts_once", "close_cash_shift_once"]) {
    expect(fn(name)).toContain("security definer set search_path = public");
    expect(schema).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^;]+from public, anon, authenticated`));
    expect(schema).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^;]+to service_role`));
    expect(drop).toContain(`drop function if exists public.${name}(`);
  }
  expect(schema).not.toContain("drop function"); expect(schema).not.toContain("not null default");
  expect(schema.match(/create unique index/g)).toHaveLength(6);
});
