import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
function definition(name: string): string {
  const start = schema.indexOf(`create or replace function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  return schema.slice(start, schema.indexOf("$$;", start));
}
const collect = definition("collect_table_reviewed_v1");

it("S21 checks the reviewed balance under the shared money lock before any money or split write", () => {
  const lock = collect.indexOf("public.lock_restaurant_money(p_restaurant)");
  const checked = collect.indexOf("if v_owed <> p_expected then");
  expect(lock).toBeGreaterThan(-1);
  expect(checked).toBeGreaterThan(lock);
  expect(collect.indexOf("for update;")).toBeLessThan(checked);
  for (const write of ["update orders set", "insert into payments", "update bill_splits set"]) {
    expect(collect.indexOf(write)).toBeGreaterThan(checked);
  }
  expect(collect).toContain("p_tip > p_amount");
  expect(collect).toContain("if v_left <> 0 then raise exception");
  expect(collect).not.toMatch(/exception\s+when/);
});

it("S21 replays the saved amount and tip before checking a balance that its own receipt changed", () => {
  expect(collect.indexOf("'outcome','duplicate'")).toBeLessThan(collect.indexOf("if v_owed <> p_expected then"));
  expect(collect).toContain("v_seen <> p_amount + p_tip");
  expect(collect).toContain("p.currency is distinct from p_currency");
  expect(collect).toContain("s.table_id = p_table");
});

it("S21 scopes receipts to the saved debt currency, including a mixed sitting", () => {
  expect(collect).toContain("currency = p_currency");
  expect(collect).toContain("public.retained_order_coverage(p_restaurant,id)");
  expect(collect).toContain("set_config('tabletap.allocation_scope',to_json(v_ids)::text,true)");
  const snapshot = definition("snapshot_payment_scope");
  expect(snapshot).toContain("select min(currency) into new.currency from orders where id = any(new.allocation_scope)");
  expect(snapshot).toContain("currency <> new.currency");
  expect(snapshot).toContain("select c.currency, c.stripe_account_id into new.currency");
});

it("S21 keeps account collection and card checkout separate by currency", () => {
  for (const name of ["account_settle_currency_v1", "account_checkout_currency_v1"]) {
    const body = definition(name);
    expect(body).toContain("public.lock_restaurant_money(p_restaurant)");
    expect(body).toContain("currency = p_currency and account_id = p_account");
    expect(body).toContain("abs(v_owed - p_expected)");
  }
  const charge = definition("account_charge_v2");
  expect(charge).toContain("'outcome','mixed_currency'");
  expect(charge.indexOf("'outcome','mixed_currency'")).toBeLessThan(charge.indexOf("public.account_owed(p_account)"));
});

it("S21 refuses closing a new round with only the old order's receipt", () => {
  const settle = definition("settle_orders_v2");
  const check = settle.indexOf("debt full join");
  expect(check).toBeGreaterThan(settle.indexOf("public.lock_restaurant_money("));
  expect(check).toBeLessThan(settle.indexOf("update orders"));
  expect(settle.indexOf("order by id for update;")).toBeLessThan(check);
  expect(settle).toContain("coalesce(debt.owed,0) - coalesce(receipt.amount,0)");
});

it("S21 exposes the new money writers only to the service role and keeps deployed signatures", () => {
  const signatures = [
    "collect_table_reviewed_v1(uuid,uuid,numeric,text,numeric,numeric,text,text,text)",
    "account_settle_currency_v1(uuid, uuid, numeric, numeric, text, text, text, text)",
    "account_checkout_currency_v1(uuid, uuid, numeric, numeric, numeric, text)",
  ];
  const drop = readFileSync("supabase/drop.sql", "utf8");
  for (const signature of signatures) {
    expect(schema).toMatch(new RegExp(`revoke all on function public\\.${signature.replace(/[()]/g,"\\$&")} from public,\\s*anon,\\s*authenticated`));
    expect(schema).toContain(`grant execute on function public.${signature} to service_role`);
    expect(drop).toContain(`drop function if exists public.${signature}`);
  }
  for (const name of ["collect_on_sittings_v1", "account_settle_v2", "account_checkout_open_v2"]) expect(definition(name)).not.toBe("");
});
