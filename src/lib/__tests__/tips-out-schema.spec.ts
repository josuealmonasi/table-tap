import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Source contracts for tips paid out; probe-tips-out.mjs runs them in Postgres.
const schema = readFileSync("supabase/schema.sql", "utf8");
const proposal = schema;
function body(sql: string, name: string): string {
  const start = sql.lastIndexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  return sql.slice(start).split("$$;")[0];
}
const canonical = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
// The drawer still subtracts EVERY withdrawal exactly once; tips_out is only
// a line that says which of them were tips.
function preservesDrawerCalculation(sql: string): boolean {
  const totals = canonical(body(sql, "cash_shift_totals"));
  // The withdrawals CTE ends where #611's held-receipt CTE (unclassified) begins.
  const withdrawals = totals.split("withdrawals as (")[1]?.split(", unclassified as (")[0]?.trim() ?? "";
  return withdrawals.startsWith("select coalesce(sum(m.amount), 0) amount,")
    && withdrawals.endsWith("and m.kind = 'withdrawal' and m.currency = s.currency )")
    && totals.includes("'expected', round(s.opening_amount + r.amount + u.amount - f.amount - h.amount - w.amount, 2)");
}
it("adds a checked non-null purpose defaulting old movements to other", () => {
  expect(schema).toContain("add column if not exists purpose text not null default 'other'\n  check (purpose in ('tips', 'other'))");
});
it.each(["create_cash_withdrawal", "create_cash_withdrawal_once"])("%s writes purpose under the money lock", name => {
  const sql = body(proposal, name);
  // Required: a default would make the deployed five-argument call ambiguous.
  expect(sql).toMatch(/p_purpose text\s*\)/);
  expect(sql).not.toContain("p_purpose text default");
  expect(sql).toContain("p_purpose is null or p_purpose not in ('tips', 'other')");
  expect(sql).toContain("note, actor_email, purpose, created_at)");
  expect(sql).toContain("p_note, p_actor, p_purpose, clock_timestamp()");
  expect(sql.indexOf("perform public.lock_restaurant_money(p_restaurant)")).toBeLessThan(sql.indexOf("insert into cash_movements"));
  expect(sql).toContain("restaurant_id = p_restaurant and id = p_shift and closed_at is null for update");
});
it("includes purpose in retry identity and preserves replay before the closed-shift check", () => {
  const sql = body(proposal, "create_cash_withdrawal_once");
  expect(sql).toContain("(m.shift_id, m.amount, m.note, m.purpose) is distinct from (p_shift, p_amount, p_note, p_purpose)");
  expect(sql).toContain("errcode = 'PT409'");
  expect(sql.indexOf("return jsonb_build_object('id', m.id")).toBeLessThan(sql.indexOf("closed_at is null"));
});
it("keeps the deployed signatures, grants the new ones only to service_role and tears both down", () => {
  const drop = readFileSync("supabase/drop.sql", "utf8");
  for (const [name, args] of [["create_cash_withdrawal", "uuid, uuid, numeric, text, text"],
    ["create_cash_withdrawal_once", "uuid, uuid, numeric, text, text, uuid"]]) {
    expect(schema).not.toContain(`drop function if exists public.${name}(`);
    expect(schema).toContain(`revoke all on function public.${name}(${args}, text) from public, anon, authenticated;`);
    expect(schema).toContain(`grant execute on function public.${name}(${args}, text) to service_role;`);
    expect(drop).toContain(`drop function if exists public.${name}(${args});`);
    expect(drop).toContain(`drop function if exists public.${name}(${args}, text);`);
  }
});
it("reports only tip-purpose withdrawals as tips_out while preserving the full drawer calculation", () => {
  const sql = body(proposal, "cash_shift_totals");
  expect(sql).toContain("coalesce(sum(m.amount) filter (where m.purpose = 'tips'), 0) tips_out");
  expect(sql).toContain("'tips_out', round(w.tips_out, 2)");
  expect(sql).toContain("'expected', round(s.opening_amount + r.amount + u.amount - f.amount - h.amount - w.amount, 2)");
  expect(preservesDrawerCalculation(proposal)).toBe(true);
});
it.each([
  ["subtracts tips twice", "- w.amount, 2)", "- w.amount - w.tips_out, 2)"],
  ["excludes tips from total withdrawals", "m.kind = 'withdrawal'", "m.kind = 'withdrawal' and m.purpose = 'other'"],
  ["counts only tips as total withdrawals", "coalesce(sum(m.amount), 0) amount,", "coalesce(sum(m.amount) filter (where m.purpose = 'tips'), 0) amount,"],
])("rejects a planted variant that %s", (_name, from, to) => {
  const planted = proposal.replace(from, to);
  expect(planted).not.toBe(proposal);
  expect(preservesDrawerCalculation(planted)).toBe(false);
});
