import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const schema = readFileSync("supabase/schema.sql", "utf8");
const fn = (name: string) => schema.slice(schema.lastIndexOf(`create or replace function public.${name}(`)).split("$$;")[0];
it("I3 calculates and inserts one exact receipt manifest under the settlement lock", () => {
  const sql = fn("record_terminal_deposit_v1");
  expect(sql.indexOf("lock_restaurant_money")).toBeLessThan(sql.indexOf("with ledger"));
  expect(sql).toContain("array_agg(payment_id order by payment_id)");
  expect(sql).toContain("snapshot_at, payment_ids, return_ids, fee_pct");
  expect(sql).toContain("clock_timestamp(), v_payments, v_returns, v_fee");
  expect(sql).not.toMatch(/created_at\s*>=/);
});
it("I4 records reconciled return identities and excludes signed days from later return targets", () => {
  const sql = fn("record_terminal_deposit_v1");
  expect(sql).toContain("r.id = any(d.return_ids)");
  expect(sql).toContain("not exists(select 1 from marks d where d.sales_day = s.day)");
  expect(sql).toContain("consumed is null and target = p_day");
  expect(fn("delete_terminal_deposit_v1")).toMatch(/lock_restaurant_money[\s\S]*delete from terminal_deposits/);
});
it("I7 joins each completed terminal return through both allocation layers to the original receipt", () => {
  const sql = fn("terminal_deposit_ledger_v1");
  expect(sql).toContain("ra.operation_id = r.id and ra.restaurant_id = p_restaurant");
  expect(sql).toContain("pa.id = ra.allocation_id and pa.restaurant_id = p_restaurant");
  expect(sql).toContain("p.id = pa.payment_id and p.restaurant_id = p_restaurant");
  expect(sql).toContain("ra.amount, ra.tip, p.created_at");
  expect(sql).toContain("r.status = 'succeeded'");
});
it("keeps snapshot RPCs service-only and old deposit inserts compatible", () => {
  for (const [name, signature] of [["terminal_deposit_ledger_v1", "uuid, text"], ["record_terminal_deposit_v1", "uuid, date, text, numeric, text, text"], ["delete_terminal_deposit_v1", "uuid, date, text"]]) {
    expect(fn(name)).toContain("security definer set search_path = public");
    expect(schema).toContain(`revoke all on function public.${name}(${signature}) from public, anon, authenticated`);
    expect(schema).toContain(`grant execute on function public.${name}(${signature}) to service_role`);
  }
  for (const column of ["snapshot_at timestamptz", "payment_ids uuid[]", "return_ids text[]", "fee_pct numeric"]) {
    expect(schema).toContain(`alter table public.terminal_deposits add column if not exists ${column};`);
  }
});
