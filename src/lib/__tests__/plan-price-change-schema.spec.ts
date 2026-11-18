import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps a price change and every eligible notice in one service-only transaction", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const fn = sql.split("create or replace function public.schedule_plan_price_change(")[1].split("$$;")[0];
  expect(fn).toContain("security definer set search_path = public");
  expect(fn).toMatch(/insert into plan_price_changes[\s\S]*insert into plan_price_notices/);
  expect(fn).toMatch(/where plan = p_plan and founding_number is null/);
  expect(fn).toContain("p_effective_at < now() + interval '30 days'");
  expect(sql).toContain("revoke all on plan_price_changes from anon, authenticated, public");
  expect(sql).toContain("revoke all on plan_price_notices from anon, authenticated, public");
  expect(sql).toContain("revoke all on function public.schedule_plan_price_change(text, numeric, timestamptz, text) from public, anon, authenticated");
  expect(sql).toContain("grant execute on function public.schedule_plan_price_change(text, numeric, timestamptz, text) to service_role");
});

it("adds the retry snapshot and queue age without widening access", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  expect(sql).toContain("alter table plan_price_notices add column if not exists mail_body jsonb;");
  expect(sql).toContain("alter table plan_price_notices add column if not exists created_at timestamptz not null default now();");
  expect(sql).toContain("revoke all on plan_price_notices from anon, authenticated, public;");
});
