import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const schema = readFileSync("supabase/schema.sql", "utf8");
const drop = readFileSync("supabase/drop.sql", "utf8");
const body = (name: string) => {
  const start = schema.lastIndexOf(`create or replace function public.${name}(`);
  return schema.slice(start, schema.indexOf("$$;", start));
};
it("N1: counter quote and currency are checked under lock before the flag or payment", () => {
  const fn = body("settle_orders_v2");
  const lock = fn.indexOf("public.lock_restaurant_money(p_restaurant)");
  const rows = fn.indexOf("order by id for update;");
  const check = fn.indexOf("v_total <> p_expected");
  const flag = fn.indexOf("update orders set ticket_email_skip");
  expect(lock).toBeGreaterThan(-1); expect(rows).toBeGreaterThan(lock);
  expect(check).toBeGreaterThan(rows); expect(flag).toBeGreaterThan(check);
  expect(fn.indexOf("return public.settle_orders_v2(")).toBeGreaterThan(flag);
  for (const guard of ["table_id is null", "currency = p_currency", "not paid", "not written_off", "account_id is null",
    "status not in ('cancelled','pending_payment')", "v_count <> cardinality(p_orders)", "p_expected <> round(p_expected, 2)"]) expect(fn).toContain(guard);
});
it.each([["collect_table_reviewed_v1", "written"], ["collect_split_slots_v1", "collected"]])(
  "N7: %s keeps the flag only with a newly written payment", (name, success) => {
    const fn = body(name);
    const flag = fn.indexOf("update orders set ticket_email_skip");
    expect(flag).toBeGreaterThan(fn.indexOf("public.lock_restaurant_money(p_restaurant)"));
    expect(fn.indexOf(`v_result := public.${name}(`)).toBeGreaterThan(flag);
    expect(fn).toContain(`if v_result->>'outcome' is distinct from '${success}' then raise exception using errcode = 'PT001'`);
    expect(fn).toContain("exception when sqlstate 'PT001' then return v_result");
    expect(fn).toContain("and not paid and not written_off and account_id is null");
  },
);
it("N1/N7: required overloads preserve old signatures and service-only grants", () => {
  for (const signature of [
    "settle_orders_v2(uuid, uuid[], text, text, jsonb, numeric, text, boolean)",
    "collect_table_reviewed_v1(uuid, uuid, numeric, text, numeric, numeric, text, text, text, boolean)",
    "collect_split_slots_v1(uuid, uuid, int, int[], int, text, int, text, text, text, boolean)",
  ]) {
    expect(schema).toContain(`drop function if exists public.${signature};`);
    expect(drop).toContain(`drop function if exists public.${signature};`);
    expect(schema).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
    expect(schema).toContain(`grant execute on function public.${signature} to service_role;`);
    const name = signature.split("(")[0];
    expect(body(name)).toContain("security definer set search_path = public");
    expect(body(name).split("returns")[0]).not.toContain("default");
    expect(schema.match(new RegExp(`create or replace function public.${name}\\(`, "g"))!.length).toBeGreaterThanOrEqual(2);
  }
});
it("N13: the database owns the indexed merged decision clock", () => {
  expect(schema).toContain("add column if not exists decision_at timestamptz\n  generated always as (greatest(approved_at, resolved_at)) stored");
  expect(schema).toContain("on public.offline_sale_queue (restaurant_id, decision_at desc, pos_ref)");
});
