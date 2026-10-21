import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
const drop = readFileSync("supabase/drop.sql", "utf8");
function definition(name: string): string {
  return schema.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0] ?? "";
}

it("I1 locks money before reading the shift, and keeps each write inside that transaction", () => {
  for (const [name, write] of [["close_cash_shift", "update cash_shifts"], ["create_cash_withdrawal", "insert into cash_movements"], ["delete_cash_withdrawal", "delete from cash_movements"]]) {
    const sql = definition(name);
    expect(sql).toContain("security definer set search_path = public");
    const lock = sql.indexOf("perform public.lock_restaurant_money(p_restaurant)");
    const read = sql.indexOf("select * into s from cash_shifts");
    expect(lock).toBeGreaterThan(0);
    expect(read).toBeGreaterThan(lock);
    expect(sql).toContain("restaurant_id = p_restaurant and id = p_shift and closed_at is null for update");
    expect(sql.indexOf(write)).toBeGreaterThan(read);
    expect(sql.indexOf("if not found then return null; end if;")).toBeLessThan(sql.indexOf(write));
  }
  const close = definition("close_cash_shift");
  expect(close.indexOf("v_at := clock_timestamp()")).toBeGreaterThan(close.indexOf("for update"));
  expect(close.indexOf("public.cash_shift_totals(p_restaurant, p_shift, v_at)")).toBeLessThan(close.indexOf("update cash_shifts"));
  expect(close).toContain("expected_cash = (v_sum->>'expected')::numeric, difference = v_difference");
});

it("I2 freezes currencies without changing existing writer signatures or requiring new insert fields", () => {
  const sql = definition("freeze_cash_currency");
  expect(sql).toContain("new.currency is distinct from old.currency");
  expect(sql).toContain("new.restaurant_id is distinct from old.restaurant_id");
  expect(sql).toContain("new.shift_id is distinct from old.shift_id");
  expect(sql).toContain("where id = new.shift_id and restaurant_id = new.restaurant_id");
  expect(sql).toContain("select currency into new.currency from restaurants");
  for (const table of ["cash_shifts", "cash_movements"]) {
    expect(schema).toContain(`alter table ${table} add column if not exists currency text`);
    expect(schema).toContain(`create trigger freeze_cash_currency before insert or update on ${table}`);
    expect(schema).toContain(`alter table ${table} alter column currency set not null`);
  }
  expect(schema).toContain("s.restaurant_id = m.restaurant_id and m.currency is null");
});

it("I2 uses the same stored-currency sum for the close and review, without doubling imported returns", () => {
  const sql = definition("cash_shift_totals");
  for (const part of ["p.currency = s.currency", "f.currency = s.currency", "m.currency = s.currency",
    "p.method = 'cash'", "f.status = 'succeeded' and f.source = 'cash'", "nullif(f.payout_actor, '') is not null",
    "f.historical_log_id = l.id", "p.created_at between s.opened_at and s.until_at",
    "f.completed_at between s.opened_at and s.until_at", "'expected', round(s.opening_amount + r.amount - f.amount - h.amount - w.amount, 2)"]) expect(sql).toContain(part);
  expect(sql).not.toContain("from restaurants");
  expect(readFileSync("src/lib/cash-shift-server.ts", "utf8")).toContain('rpc("cash_shift_totals"');
});

it("I13 selects overnight closes and late original-currency cash without a row cap or duplicate shifts", () => {
  const sql = definition("cash_shifts_for_day");
  expect(sql).toContain("s.restaurant_id = p_restaurant");
  expect(sql).toContain("s.closed_at >= p_day_start");
  expect(sql).toContain("s.closed_at is null");
  expect(sql).toContain("or exists(select 1 from payments p");
  expect(sql).toContain("p.recorded_at >= p_day_start and p.recorded_at > s.closed_at");
  expect(sql).toContain("p.created_at between s.opened_at and s.closed_at");
  expect(sql).toContain("p.currency = s.currency");
  expect(sql).not.toMatch(/\blimit\b/i);
});

it("restricts every new helper to the server and registers it for teardown", () => {
  for (const [name, args] of [["freeze_cash_currency", ""], ["cash_shift_totals", "uuid, uuid, timestamptz"],
    ["close_cash_shift", "uuid, uuid, numeric, text"], ["create_cash_withdrawal", "uuid, uuid, numeric, text, text"],
    ["delete_cash_withdrawal", "uuid, uuid, uuid"], ["cash_shifts_for_day", "uuid, timestamptz"]]) {
    expect(schema).toContain(`revoke all on function public.${name}(${args}) from public, anon, authenticated`);
    expect(schema).toContain(`grant execute on function public.${name}(${args}) to service_role`);
    expect(drop).toContain(`drop function if exists public.${name}(${args})`);
  }
});
