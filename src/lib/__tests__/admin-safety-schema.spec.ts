import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync("supabase/schema.sql", "utf8");
const drop = readFileSync("supabase/drop.sql", "utf8");
const body = sql.split("create or replace function public.admin_delete_restaurant(")[1]?.split("$$;")[0] ?? "";
it("checks obligations and receipts under the money and restaurant locks before deleting", () => {
  expect(body.indexOf("lock_restaurant_money(p_restaurant)")).toBeLessThan(body.indexOf("for update"));
  for (const table of ["refund_operations", "refunds_due", "refund_attempts", "refund_due_attempts",
    "diner_checkouts", "account_checkouts", "platform_fees", "orders", "payments", "cash_shifts",
    "cash_movements", "terminal_deposits", "customer_accounts", "ingredient_purchases"]) {
    const check = new RegExp(`exists \\(select 1 from ${table} where restaurant_id = p_restaurant`);
    expect(body).toMatch(check);
    expect(body.search(check)).toBeGreaterThan(body.indexOf("for update"));
    expect(body.search(check)).toBeLessThan(body.indexOf("delete from restaurants"));
  }
  expect(body).toContain("status <> 'succeeded'");
  expect(body).toContain("refunded_at is null");
  expect(body).toContain("provider_status is null or provider_status not in ('succeeded', 'failed', 'canceled')");
  expect(body).toContain("if p_check_only is distinct from false then");
  expect(sql).toContain("revoke all on function public.admin_delete_restaurant(uuid, boolean) from public, anon, authenticated;");
  expect(drop).toContain("drop function if exists public.admin_delete_restaurant(uuid, boolean);");
});
it("keeps platform history outside deletion cascades and denies client access or mutation", () => {
  const table = sql.split("create table if not exists platform_admin_audit (")[1]?.split("\n);")[0] ?? "";
  expect(table).toContain("actor_id uuid not null");
  expect(table).not.toMatch(/references|foreign key/i);
  expect(sql).toContain("alter table platform_admin_audit enable row level security;");
  expect(sql).toContain("revoke all on platform_admin_audit from anon, authenticated, public, service_role;");
  expect(sql).toContain("grant select, insert on platform_admin_audit to service_role;");
  expect(sql).toContain("before update or delete or truncate\n  on platform_admin_audit for each statement");
  expect(sql).toContain("raise exception 'Platform admin audit is append-only'");
  expect(drop).toContain("drop table if exists platform_admin_audit cascade;");
});
