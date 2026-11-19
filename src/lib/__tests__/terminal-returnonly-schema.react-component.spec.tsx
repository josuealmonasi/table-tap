import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Source contracts only: no PostgreSQL is started or contacted in this worktree.
const sql = readFileSync("supabase/schema.sql", "utf8");
const assigned = sql.split("), assigned as (")[1];

it("F6 proposes a locked, scoped writer accepting a signed MX$40 bank debit with no sales", () => {
  expect(sql).toContain("perform public.lock_restaurant_money(p_restaurant)");
  expect(sql).toContain("public.terminal_deposit_ledger_v1(p_restaurant, p_currency)");
  expect(sql).toContain("where restaurant_id = p_restaurant and currency = p_currency");
  expect(sql).toContain("p_received < -100000000 or p_received > 100000000");
  expect(sql).toContain("coalesce((select sum(net) - round(sum(net) * v_fee / 100, 2) from receipts where sale_day = p_day), 0)");
  expect(sql).toContain("- coalesce((select sum(debit) from assigned where not same_day and consumed is null and target = p_day), 0)");
  expect(sql).toContain("else r.amount end debit");
  expect(sql).toContain("exists(select 1 from assigned where not same_day and consumed is null and target = p_day)");
  expect(sql).toContain("if not v_has_sales and not v_has_returns then return jsonb_build_object('error', 'no_sales')");
  expect(sql).toContain("snapshot_at, payment_ids, return_ids, fee_pct");
  expect(sql).toContain("clock_timestamp(), v_payments, v_returns, v_fee");
});

it("F6 assigns an unconsumed return to its own unsigned day only after looking for a sales day", () => {
  expect(assigned).toMatch(/coalesce\(\(select min\(s.day\) from sales s where s.day >= r.day[\s\S]*?not exists\(select 1 from marks d where d.sales_day = s.day\)\),/);
  expect(assigned).toContain("select min(r.day + candidate.offset_days)");
  expect(assigned).toContain("generate_series(0, (select count(*)::int from marks)) as candidate(offset_days)");
  expect(assigned).toContain("where not exists(select 1 from marks d where d.sales_day = r.day + candidate.offset_days))) target");
});

it("F6 a sale appearing tomorrow before marking takes precedence over today's return-only day", () => {
  expect(assigned.indexOf("select min(s.day)")).toBeLessThan(assigned.indexOf("select min(r.day + candidate.offset_days)"));
  expect(sql).toContain("select distinct sale_day as day from receipts where net > 0");
  expect(sql).toContain("not exists(select 1 from marks d where d.sales_day = s.day)");
  // The same target controls both the debit and manifest membership.
  expect(sql).toContain("and ((same_day and sale_day = p_day) or (not same_day and target = p_day)))");
});

it("F6 a marked return-only manifest consumes its returns before any later sales can carry them", () => {
  expect(sql).toContain("r.id = any(d.return_ids)");
  expect(sql).toContain("select array_agg(id order by id) from assigned where consumed is null");
  expect(sql).toContain("not same_day and consumed is null and target = p_day");
  expect(sql).toContain("return jsonb_build_object('error', 'marked')");
  expect(sql).toContain("revoke all on function public.record_terminal_deposit_v1(uuid, date, text, numeric, text, text) from public, anon, authenticated");
});
