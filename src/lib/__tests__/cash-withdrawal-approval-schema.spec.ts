import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Cash withdrawals: approval, cap and retired references (2026-11-25). Source
// contracts for the SQL; the writers' order of operations is what holds them.
const schema = readFileSync("supabase/schema.sql", "utf8");
const drop = readFileSync("supabase/drop.sql", "utf8");
/** The first definition: the writer. A deployed signature after it only delegates. */
function first(name: string): string {
  const start = schema.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  return schema.slice(start).split("$$;")[0];
}
/** The definition whose argument list starts with this text. */
function signed(head: string): string {
  const start = schema.indexOf(`create or replace function public.${head}`);
  if (start < 0) throw new Error(`Missing function ${head}`);
  return schema.slice(start).split("$$;")[0];
}

it("adds a checked status, approved for every existing row, and the reviewer", () => {
  expect(schema).toContain("alter table cash_movements add column if not exists status text not null default 'approved'\n  check (status in ('pending', 'approved', 'rejected'))");
  expect(schema).toContain("alter table cash_movements add column if not exists reviewed_by text;");
  expect(schema).toContain("alter table cash_movements add column if not exists reviewed_at timestamptz;");
  // Before the totals that read it: an sql function's body is checked when created.
  expect(schema.indexOf("add column if not exists status text")).toBeLessThan(schema.indexOf("create or replace function public.cash_shift_totals("));
});

it("subtracts only approved withdrawals from expected cash", () => {
  const totals = first("cash_shift_totals");
  const withdrawals = totals.split("withdrawals as (")[1].split("unclassified as (")[0];
  expect(withdrawals).toContain("m.status = 'approved'");
});

it("decides pending from the role, failing safe for anything but owner or manager", () => {
  const status = first("cash_withdrawal_status");
  expect(status).toContain("case when p_role in ('owner', 'manager') then 'approved' else 'pending' end");
});

it("refuses any withdrawal that would take expected cash below zero, in words the route maps", () => {
  const room = first("check_cash_withdrawal_room");
  expect(room).toContain("public.cash_shift_totals(p_restaurant, p_shift, clock_timestamp())->>'expected'");
  expect(room).toContain("status = 'pending'");
  expect(room).toContain("if v_room is null or v_room - p_amount < 0 then");
  expect(room).toContain("errcode = 'PT422'");
});

it.each([
  ["create_cash_withdrawal(p_restaurant uuid, p_shift uuid, p_amount numeric, p_note text, p_actor text, p_role text, p_purpose text)"],
  ["create_cash_withdrawal_once(\n  p_restaurant uuid, p_shift uuid, p_amount numeric, p_note text, p_actor text, p_ref uuid, p_role text, p_purpose text"],
])("%s writes the role's status and checks the cap under the lock, after the shift row and before the insert", head => {
  const sql = signed(head);
  const lock = sql.indexOf("perform public.lock_restaurant_money(p_restaurant)");
  const shift = sql.indexOf("closed_at is null for update");
  const cap = sql.indexOf("perform public.check_cash_withdrawal_room(p_restaurant, s.id, p_amount, true)");
  const insert = sql.indexOf("insert into cash_movements");
  expect(lock).toBeGreaterThan(0);
  expect(shift).toBeGreaterThan(lock);
  expect(cap).toBeGreaterThan(shift);
  expect(insert).toBeGreaterThan(cap);
  expect(sql).toContain("v_status text := public.cash_withdrawal_status(p_role)");
  expect(sql).toContain("'withdrawal', v_status, p_amount");
});

it("keeps the deployed signatures as delegates that record as before, under the same cap", () => {
  expect(schema).toContain("select public.create_cash_withdrawal(p_restaurant, p_shift, p_amount, p_note, p_actor, 'manager'::text, p_purpose);");
  expect(schema).toContain("select public.create_cash_withdrawal_once(p_restaurant, p_shift, p_amount, p_note, p_actor, p_ref, 'manager'::text, p_purpose);");
  // A new parameter is required, never defaulted: no call can be ambiguous.
  expect(schema).not.toMatch(/p_role text default/);
});

it("retires a removed withdrawal's reference in the removal's own transaction", () => {
  const sql = first("delete_cash_withdrawal");
  const removed = sql.indexOf("delete from cash_movements");
  const retired = sql.indexOf("insert into cash_withdrawal_retired_refs");
  expect(removed).toBeGreaterThan(sql.indexOf("perform public.lock_restaurant_money(p_restaurant)"));
  expect(retired).toBeGreaterThan(removed);
  expect(sql).toContain("if m.request_ref is not null then");
  expect(schema).toContain("primary key (restaurant_id, request_ref),\n  foreign key (restaurant_id, shift_id) references cash_shifts(restaurant_id, id) on delete cascade");
});

it("a retry finds a retired reference before it could insert, and answers with the removal", () => {
  const sql = signed("create_cash_withdrawal_once(\n  p_restaurant uuid, p_shift uuid, p_amount numeric, p_note text, p_actor text, p_ref uuid, p_role text");
  const live = sql.indexOf("select * into m from cash_movements where restaurant_id = p_restaurant and request_ref = p_ref");
  const retired = sql.indexOf("select * into r from cash_withdrawal_retired_refs where restaurant_id = p_restaurant and request_ref = p_ref");
  expect(retired).toBeGreaterThan(live);
  expect(retired).toBeLessThan(sql.indexOf("closed_at is null for update"));
  expect(retired).toBeLessThan(sql.indexOf("insert into cash_movements"));
  expect(sql).toContain("(r.shift_id, r.amount, r.note, r.purpose) is distinct from (p_shift, p_amount, p_note, p_purpose)");
  expect(sql).toContain("'outcome', 'removed'");
});

it("only a manager reviews, only a pending withdrawal changes, and an approval must still fit", () => {
  const sql = first("review_cash_withdrawal");
  expect(sql).toContain("if p_role is null or p_role not in ('owner', 'manager') then raise exception 'manager required'");
  expect(sql.indexOf("perform public.lock_restaurant_money(p_restaurant)")).toBeLessThan(sql.indexOf("closed_at is null for update"));
  expect(sql).toContain("if m.status <> 'pending' then");
  expect(sql).toContain("'outcome', 'decided'");
  const cap = sql.indexOf("perform public.check_cash_withdrawal_room(p_restaurant, s.id, m.amount, false)");
  expect(cap).toBeGreaterThan(0);
  expect(cap).toBeLessThan(sql.indexOf("update cash_movements set status = p_decision"));
});

it("the close refuses while a withdrawal awaits approval, before it signs, and the saved close passes that on", () => {
  const close = first("close_cash_shift");
  const pending = close.indexOf("'outcome', 'pending_withdrawals'");
  expect(pending).toBeGreaterThan(close.indexOf("perform public.lock_restaurant_money(p_restaurant)"));
  expect(pending).toBeLessThan(close.indexOf("update cash_shifts"));
  expect(first("close_cash_shift_once")).toContain("in ('held_cash', 'pending_withdrawals') then return v_result");
});

it("a returned-cash resolution links only cash that actually left: an approved withdrawal", () => {
  expect(first("resolve_held_sale")).toContain("and currency = p_currency and amount = p_amount\n          and status = 'approved')");
});

it("grants the new functions only to the server, keeps the table private, and tears everything down", () => {
  for (const signature of ["cash_withdrawal_status(text)", "check_cash_withdrawal_room(uuid, uuid, numeric, boolean)",
    "create_cash_withdrawal(uuid, uuid, numeric, text, text, text, text)", "create_cash_withdrawal_once(uuid, uuid, numeric, text, text, uuid, text, text)",
    "review_cash_withdrawal(uuid, uuid, uuid, text, text, text)",
    // The deployed signatures stay granted.
    "create_cash_withdrawal(uuid, uuid, numeric, text, text, text)", "create_cash_withdrawal_once(uuid, uuid, numeric, text, text, uuid, text)"]) {
    expect(schema).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
    expect(schema).toContain(`grant execute on function public.${signature} to service_role;`);
    expect(drop).toContain(`drop function if exists public.${signature};`);
  }
  for (const rule of ["enable row level security", "revoke all on cash_withdrawal_retired_refs from anon",
    "revoke all on cash_withdrawal_retired_refs from authenticated", "grant all on cash_withdrawal_retired_refs to service_role"]) {
    expect(schema).toContain(rule.startsWith("enable") ? `alter table cash_withdrawal_retired_refs ${rule}` : rule);
  }
  expect(drop).toContain("drop table if exists cash_withdrawal_retired_refs cascade;");
});
