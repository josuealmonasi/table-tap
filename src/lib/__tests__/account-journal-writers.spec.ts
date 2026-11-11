import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const schema = readFileSync("supabase/schema.sql", "utf8");
const fn = (name: string): string => schema.split(`create or replace function public.${name}(`)[1].split("$$;")[0];

it("keeps every legacy deployed signature delegating to the reviewed writer", () => {
  for (const name of ["account_charge", "account_settle", "account_checkout_settle", "cancel_order"]) {
    expect(fn(name)).toContain(`return public.${name}_v2(`);
    expect(fn(name)).not.toMatch(/insert into|update orders/);
  }
  for (const name of ["ring_pos_account", "ring_pos_account_v2"]) expect(fn(name)).toMatch(/public.account_charge(?:_v2)?\(/);
});
it("all collection writers snapshot their new tip source and append after applying it", () => {
  for (const name of ["account_settle_v2", "account_settle_currency_v1", "account_checkout_settle_v2"]) {
    const sql = fn(name);
    expect(sql).toContain("v_payment");
    expect(sql).toContain("account_added_tip_cents, account_tip_order_id");
    expect(sql).toContain("returning id");
    expect(sql.indexOf("append_account_collection_v1(v_payment)")).toBeGreaterThan(sql.indexOf("update orders set tip = tip +"));
    expect(sql.indexOf("duplicate")).toBeLessThan(sql.indexOf("insert into payments"));
  }
  const helper = fn("append_account_collection_v1");
  expect(helper).toContain("journal_started_at is not null");
  expect(helper).toContain("'collection'"); expect(helper).toContain("'added_tip'");
  expect(helper).not.toContain("on conflict"); // Never hide a double append.
});
it("charge and credit appends are conditional and cannot hide a double append", () => {
  expect(fn("account_charge_v2")).toContain("if v_account.journal_started_at is not null then");
  expect(fn("account_charge_v2")).toContain("'charge'");
  expect(fn("account_credit_v1")).toContain("append_account_credit_movement_v1(d.id)");
  expect(fn("prepare_order_refund")).toContain("append_account_credit_movement_v1(v_adjustment)");
  expect(fn("cancel_order_v2")).toContain("append_account_credit_movement_v1(v_adjustment)");
  expect(fn("append_account_credit_movement_v1")).not.toContain("on conflict");
});
it("locks restaurant before accounts, and accounts before ordered orders including lazy allocation repair", () => {
  for (const name of ["account_charge_v2", "account_settle_v2", "account_settle_currency_v1", "account_checkout_settle_v2", "account_credit_v1", "cancel_order_v2", "prepare_order_refund"]) {
    const sql = fn(name);
    expect(sql.indexOf("lock_restaurant_money")).toBeLessThan(sql.indexOf("from customer_accounts"));
    expect(sql).toMatch(/from customer_accounts[\s\S]*?for update/);
    expect(sql).toMatch(/from orders[^;]*for update/);
  }
  const repair = fn("backfill_payment_allocations");
  expect(repair.indexOf("customer_accounts where restaurant_id = v_restaurant order by id for update"))
    .toBeLessThan(repair.indexOf("orders where restaurant_id = v_restaurant order by id for update"));
});
it("checks sources in both directions and debt at commit without repairing missing appends", () => {
  expect(schema).toContain("create constraint trigger check_account_journal");
  expect(schema).toContain("deferrable initially deferred for each row execute function public.check_account_journal_v1()");
  expect(fn("assert_account_journal_v1")).toContain("full join");
  expect(fn("assert_account_journal_v1")).toContain("account journal debt mismatch");
  expect(fn("assert_account_journal_v1")).toContain("account journal opening order mismatch");
  expect(fn("check_account_journal_v1")).toContain("append missing");
  expect(fn("check_account_journal_v1")).not.toContain("insert into");
  expect(schema).toContain("a started journal cannot import more history");
});
it("activation remains a transaction fragment and dev mock runs it before gates", () => {
  const sql = readFileSync("supabase/journal-activate.sql", "utf8");
  expect(sql.indexOf("lock_restaurant_money(r.id)")).toBeLessThan(sql.indexOf("account_journal_backfill_v1(r.id, clock_timestamp())"));
  expect(sql).not.toMatch(/^commit;/im);
  expect(sql).toContain("set default now()");
  const runner = readFileSync("scripts/db.mjs", "utf8");
  expect(runner.indexOf('join(root, "supabase/journal-activate.sql")')).toBeGreaterThan(runner.indexOf("await seedMock(client)"));
  expect(fn("start_new_account_journal_v1")).toContain("new.journal_started_at := now()");
});
