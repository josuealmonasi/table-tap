import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
it("M1: counts only recent unpaid counter checkouts, excluding table, card and account orders", () => {
  const count = schema.split("create or replace function public.counter_pay_later_full(")[1]?.split("$$;")[0];
  expect(count).toBeDefined();
  for (const condition of ["restaurant_id = p_restaurant", "table_id is null", "table_label is null", "session_id is null",
    "account_id is null", "pos_ref is null", "stripe_session_id is null", "stripe_payment_intent is null", "pay_method is null",
    "not paid", "not written_off", "status not in ('cancelled', 'pending_payment')", "interval '3 hours'", "count(*) >= 25"]) {
    expect(count).toContain(condition);
  }
  expect(readFileSync("supabase/drop.sql", "utf8")).toContain("drop function if exists public.counter_pay_later_full(uuid)");
});
it("M1: checks the ceiling under the restaurant lock, after retries and before any claims", () => {
  const writer = schema.split("create or replace function public.create_order_intent(")[1].split("$$;")[0];
  const cap = writer.indexOf("public.counter_pay_later_full(p_restaurant)");
  expect(cap).toBeGreaterThan(writer.indexOf("public.lock_restaurant_money(p_restaurant)"));
  expect(cap).toBeGreaterThan(writer.indexOf("if v_result is not null then return v_result"));
  expect(cap).toBeLessThan(writer.indexOf("public.reserve_stock("));
  expect(writer).toContain("p_order->>'table_id' is null");
  expect(writer).toContain('return \'{"counterFull":true}\'::jsonb');
});
