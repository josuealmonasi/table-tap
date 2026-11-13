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
const squash = (sql: string): string => sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

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

it("M1: retained and returned cash are received in that same shift by the collection time, closed or open", () => {
  expect(definitions("resolve_held_sale")).toHaveLength(1);
  const sql = squash(last("resolve_held_sale"));
  const pick = "select * into v_collecting from cash_shifts where restaurant_id = p_restaurant and opened_at <= p_collected_at and (closed_at is null or closed_at >= p_collected_at) order by opened_at desc, id desc limit 1 for update;";
  expect(sql).toContain(pick);
  // Chosen for both dispositions, not only retained cash.
  expect(sql.indexOf(pick)).toBeGreaterThan(sql.indexOf("elsif p_disposition in ('retained_cash', 'returned_cash') then"));
  expect(sql).not.toMatch(/if p_disposition = 'retained_cash' then select \* into v_collecting/);
  expect(sql).toContain("if found then v_recognized := least(p_collected_at, v_at); end if;");
  // The collecting shift is tried first; the open drawer is the payout's shift and the fallback.
  const open = "select * into s from cash_shifts where restaurant_id = p_restaurant and closed_at is null for update;";
  expect(sql.indexOf(pick)).toBeLessThan(sql.indexOf(open));
  expect(sql).toContain(`if p_disposition = 'returned_cash' or v_recognized is null then ${open} if not found then raise exception 'open shift required'; end if; end if;`);
  expect(sql).toContain("if v_recognized is null then v_collecting := s; v_recognized := v_at; end if;");
  expect(sql).toContain("values(p_restaurant, p_ref, v_collecting.id, p_amount, p_currency, btrim(p_collector), p_collected_at, v_recognized)");
  expect(sql).not.toMatch(/values\(p_restaurant, p_ref, s\.id,/);
});

it("M1: returned cash pays out from the open shift, where the cash physically left the drawer", () => {
  const sql = squash(last("resolve_held_sale"));
  expect(sql).toContain("and shift_id = s.id and currency = p_currency and amount = p_amount");
  expect(sql).toContain("if p_disposition = 'returned_cash' and p_currency <> s.currency then");
});

it("M1: a closed shift corrected by retained or returned cash shows in that day's handover, as a late approval does", () => {
  const day = squash(last("cash_shifts_for_day"));
  expect(day).toContain("p.recorded_at >= p_day_start and p.recorded_at > s.closed_at");
  expect(day).toContain("r.disposition in ('retained_cash', 'returned_cash') and c.shift_id = s.id");
  expect(day).toContain("r.resolved_at >= p_day_start and r.resolved_at > s.closed_at");
});

it("M2: returned cash links only a withdrawal recorded for another purpose, never a tips payout", () => {
  const sql = squash(last("resolve_held_sale"));
  expect(sql).toContain("kind = 'withdrawal' and purpose = 'other' and shift_id = s.id and currency = p_currency and amount = p_amount");
  // The purposes a withdrawal can have: tips are staff money, 'other' is the payout.
  expect(schema).toContain("check (purpose in ('tips', 'other'))");
});
