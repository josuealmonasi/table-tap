import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const schema = readFileSync("supabase/schema.sql", "utf8");
const fn = (name: string) => {
  const start = schema.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is missing`).toBeGreaterThan(-1);
  return schema.slice(start, schema.indexOf("$$;", start));
};

describe("account money SQL guards", () => {
  it("refuses a cancellation whose paid state or account hold changed", () => {
    const cancel = fn("cancel_order");
    expect(cancel).toContain("p_expected_paid");
    expect(cancel).toContain("p_expected_account");
    expect(cancel).toContain("p_expected_hold");
    expect(cancel).toMatch(/paid is distinct from p_expected_paid/);
    expect(cancel).toMatch(/checkout_until is distinct from p_expected_hold/);
    expect(cancel).toMatch(/checkout_id is distinct from p_expected_checkout/);
    expect(cancel.indexOf("from customer_accounts")).toBeLessThan(cancel.indexOf("from orders where id = p_order and restaurant_id = p_restaurant for update"));
    expect(cancel.indexOf("p_expected_checkout then")).toBeLessThan(cancel.indexOf("update orders set status"));
  });
  it("keeps the stock gate on the guarded cancellation signature", () => {
    const gate = readFileSync("scripts/attack-stock.mjs", "utf8");
    expect(gate).not.toContain("cancel_order($1,$2,null,$3)");
    expect(gate).toContain("cancel_order(uuid,uuid,text,jsonb,boolean,uuid,timestamptz,uuid)");
  });
  it("never collects written-off debt, including already-open checkouts", () => {
    for (const name of ["account_owed", "account_settle_v2", "account_checkout_open_v2", "account_checkout_settle_v2"]) {
      const body = fn(name);
      const reads = body.match(/from orders[^;]+/g) ?? [];
      expect(reads.length).toBeGreaterThan(0);
      for (const read of reads) expect(read, name).toContain("written_off = false");
    }
  });
  it("clears only the checkout that owns the account hold", () => {
    expect(schema).toContain("add column if not exists checkout_id uuid");
    expect(fn("account_checkout_open_v2")).toContain("checkout_id = v_id");
    for (const name of ["account_checkout_settle_v2", "account_checkout_release"]) {
      expect(fn(name)).toMatch(/update customer_accounts set checkout_until = null, checkout_id = null[^;]+and checkout_id = p_checkout/);
    }
  });
  it("locks checkout orders before calculating the money still owed", () => {
    const settle = fn("account_checkout_settle_v2");
    const lock = settle.indexOf("for update;", settle.indexOf("perform 1 from orders"));
    expect(settle).toMatch(/perform 1 from orders[^;]+order by id for update;/);
    expect(lock).toBeGreaterThan(0);
    expect(lock).toBeLessThan(settle.indexOf("select array_agg"));
  });
  it("locks the account before its checkouts on open, settle and release", () => {
    for (const name of ["account_checkout_open_v2", "account_checkout_settle_v2", "account_checkout_release"]) {
      const body = fn(name);
      const accountLock = body.indexOf("from customer_accounts");
      expect(accountLock).toBeGreaterThan(0);
      const checkoutWrite = body.search(/(?:from account_checkouts[^;]+for update|update account_checkouts|insert into account_checkouts)/);
      expect(accountLock).toBeLessThan(checkoutWrite);
    }
  });
  it("rechecks debt under the charge lock before lowering a ceiling or closing", () => {
    const change = fn("account_change_v2");
    expect(change).toMatch(/from customer_accounts[^;]+restaurant_id = p_restaurant for update;/);
    expect(change.indexOf("for update;")).toBeLessThan(change.indexOf("public.account_owed"));
    expect(change).toContain("p_limit < v_owed");
    expect(change).toContain("v_owed > 0");
    expect(change).toContain("'limit'");
    expect(change).toContain("'owes'");
    expect(schema).toContain("revoke all on function public.account_change_v2(uuid, uuid, text, numeric, text) from public, anon, authenticated;");
  });
});
