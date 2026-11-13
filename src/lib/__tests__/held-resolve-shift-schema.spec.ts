import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Full review M1 and M2: a held cash receipt must land in the same shift
// whether a manager approves it or resolves it as retained cash, and returned
// cash must never be backed by a tips payout.
const schema = readFileSync("supabase/schema.sql", "utf8");
function definitions(name: string): string[] {
  return [...schema.matchAll(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, "g"))].map(m => m[0]);
}
const last = (name: string): string => definitions(name).at(-1) ?? "";
const squash = (sql: string): string => sql.replace(/\s+/g, " ");

it("M1: approval dates the cash at the sale's time, and the drawer counts it in the shift whose window holds that time", () => {
  const record = squash(last("record_offline_sale"));
  expect(record).toContain("v_ticket := public.ring_pos_sale_v2(p_restaurant, p_ref, p_order, p_method, p_actor,");
  expect(record).toMatch(/end, p_at, p_terminal, v_demand, false, 0\)/);
  expect(squash(last("ring_pos_sale_v2"))).toContain("perform public.settle_offline_sale_v2(p_restaurant, p_ref, p_method, p_actor, p_at)");
  expect(squash(last("settle_offline_sale_v2"))).toContain("values (p_restaurant, p_order, round(v_total, 2), p_method, p_actor, p_at)");
  const totals = squash(last("cash_shift_totals"));
  expect(totals).toContain("least(coalesce(closed_at, p_until), p_until) until_at");
  expect(totals).toContain("p.created_at between s.opened_at and s.until_at");
  // A retained receipt is counted by its shift and its recognized time.
  expect(totals).toContain("c.shift_id = s.id and c.currency = s.currency and c.recognized_at between s.opened_at and s.until_at");
});

it("M1: retained cash picks that same shift by the collection time, closed or open, dated the same way", () => {
  expect(definitions("resolve_held_sale")).toHaveLength(1);
  const sql = squash(last("resolve_held_sale"));
  const pick = "and opened_at <= p_collected_at and (closed_at is null or closed_at >= p_collected_at) order by opened_at desc, id desc limit 1 for update;";
  expect(sql).toContain(`if p_disposition = 'retained_cash' then`);
  expect(sql).toContain(pick);
  expect(sql).toContain("if found then v_recognized := least(p_collected_at, v_at); end if;");
  // The collecting shift is tried before the open drawer, which is only the fallback.
  expect(sql.indexOf(pick)).toBeLessThan(sql.indexOf("and closed_at is null for update"));
  expect(sql).toContain("if v_recognized is null then");
  expect(sql).toContain("if not found then raise exception 'open shift required'; end if; v_recognized := v_at;");
  expect(sql).toContain("values(p_restaurant, p_ref, s.id, p_amount, p_currency, btrim(p_collector), p_collected_at, v_recognized)");
  expect(sql).not.toMatch(/p_collected_at, v_at\) returning id into v_receipt/);
});

it("M1: a closed shift corrected by retained cash shows in that day's handover, as a late approval does", () => {
  const day = squash(last("cash_shifts_for_day"));
  expect(day).toContain("p.recorded_at >= p_day_start and p.recorded_at > s.closed_at");
  expect(day).toContain("r.disposition = 'retained_cash' and c.shift_id = s.id");
  expect(day).toContain("r.resolved_at >= p_day_start and r.resolved_at > s.closed_at");
});

it("M2: returned cash links only a withdrawal recorded for another purpose, never a tips payout", () => {
  const sql = squash(last("resolve_held_sale"));
  expect(sql).toContain("kind = 'withdrawal' and purpose = 'other' and shift_id = s.id and currency = p_currency and amount = p_amount");
  // The purposes a withdrawal can have: tips are staff money, 'other' is the payout.
  expect(schema).toContain("check (purpose in ('tips', 'other'))");
});
