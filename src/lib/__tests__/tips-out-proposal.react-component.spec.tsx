import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Source contracts only: Claude still needs to apply and probe the SQL.
const proposal = readFileSync("supabase/PROPOSAL-tips-out.sql", "utf8");
const schema = readFileSync("supabase/schema.sql", "utf8");
function body(sql: string, name: string): string {
  const start = sql.lastIndexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  return sql.slice(start).split("$$;")[0];
}
const canonical = (sql: string) => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
// Removing only the two reporting additions must recover the complete old
// calculation, including all receipt/return scopes and ALL withdrawals.
function preservesDrawerCalculation(sql: string): boolean {
  const stripped = body(sql, "cash_shift_totals")
    .replace(/,\s*coalesce\(sum\(m.amount\) filter \(where m.purpose = 'tips'\), 0\) tips_out/, "")
    .replace(/'tips_out', round\(w.tips_out, 2\),\s*/, "");
  return canonical(stripped) === canonical(body(schema, "cash_shift_totals"));
}
it("adds a checked non-null purpose defaulting old movements to other", () => {
  expect(proposal).toContain("add column if not exists purpose text\n  not null default 'other' check (purpose in ('tips', 'other'))");
});
it.each(["create_cash_withdrawal", "create_cash_withdrawal_once"])("%s writes purpose under the money lock", name => {
  const sql = body(proposal, name);
  expect(sql).toContain("p_purpose text default 'other'");
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
it("removes ambiguous old overloads and grants the replacements only to service_role", () => {
  for (const [name, args] of [["create_cash_withdrawal", "uuid, uuid, numeric, text, text"],
    ["create_cash_withdrawal_once", "uuid, uuid, numeric, text, text, uuid"]]) {
    expect(proposal).toContain(`drop function if exists public.${name}(${args});`);
    expect(proposal).toContain(`revoke all on function public.${name}(${args}, text) from public, anon, authenticated;`);
    expect(proposal).toContain(`grant execute on function public.${name}(${args}, text) to service_role;`);
  }
});
it("reports only tip-purpose withdrawals as tips_out while preserving the full drawer calculation", () => {
  const sql = body(proposal, "cash_shift_totals");
  expect(sql).toContain("coalesce(sum(m.amount) filter (where m.purpose = 'tips'), 0) tips_out");
  expect(sql).toContain("'tips_out', round(w.tips_out, 2)");
  expect(sql).toContain("'expected', round(s.opening_amount + r.amount - f.amount - h.amount - w.amount, 2)");
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
