import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
const check = (sql: string): string => sql.split("create or replace function public.check_account_journal_v1()")[1].split("$$;")[0];
const update = (sql: string): string => sql.split("create constraint trigger check_account_journal_order_update")[1].split(";")[0];
const moneyFields = ["account_id", "restaurant_id", "currency", "charged_at", "paid",
  "written_off", "total", "tip", "service_fee"];

function moneyOrderUpdates(sql: string): void {
  const trigger = update(sql).replace(/\s+/g, " ");
  const values = (version: string): string => [...moneyFields.map(field => `${version}.${field}`),
    `${version}.status = 'cancelled'`].join(", ");
  expect(trigger).toContain(`when ((old.account_id is not null or new.account_id is not null) and (${values("old")}) is distinct from (${values("new")}))`);
}

function oncePerTransaction(sql: string): void {
  const body = check(sql);
  expect(body).toContain("if v_old is null and v_new is null then return null; end if;");
  expect(body).toContain("coalesce(nullif(current_setting('tabletap.journal_checked', true), ''), '{}')::uuid[]");
  expect(body).toMatch(/foreach v_account in array array\[v_old, v_new\] loop\s+if v_account is not null and not \(v_account = any\(v_checked\)\) then\s+perform public\.assert_account_journal_v1\(v_account\);\s+v_checked := array_append\(v_checked, v_account\);\s+perform set_config\('tabletap\.journal_checked', v_checked::text, true\);\s+end if;\s+end loop;/);
  expect(body.match(/perform public\.assert_account_journal_v1\(/g)).toHaveLength(1);
  for (const message of ["charge append missing", "added tip append missing", "collection append missing"]) {
    expect(body.indexOf(message)).toBeGreaterThan(0);
    expect(body.indexOf(message)).toBeLessThan(body.indexOf("v_checked :="));
  }
}

it("reconciles both old/new accounts once, remembers only successful checks locally, and keeps per-row checks", () => {
  oncePerTransaction(schema);
});

it("planted: removing the second-row cache guard breaks the once-per-transaction schema contract", () => {
  const planted = schema.replace("and not (v_account = any(v_checked))", "");
  expect(planted).not.toBe(schema);
  expect(() => oncePerTransaction(planted)).toThrow();
});

it("exits non-account events before source lookups or account reconciliation", () => {
  const body = check(schema);
  const exit = body.indexOf("if v_old is null and v_new is null then return null; end if;");
  expect(exit).toBeGreaterThan(0);
  expect(exit).toBeLessThan(body.indexOf("if tg_table_name = 'orders' then"));
  expect(exit).toBeLessThan(body.indexOf("v_checked :="));
});

it("planted: a session-wide cache cannot replace a transaction-local cache", () => {
  expect(() => oncePerTransaction(schema.replace(
    "set_config('tabletap.journal_checked', v_checked::text, true)",
    "set_config('tabletap.journal_checked', v_checked::text, false)",
  ))).toThrow();
});

it("filters order updates before queueing deferred work, including all money fields and cancellation transitions", () => {
  moneyOrderUpdates(schema);
  const trigger = update(schema);
  expect(trigger).toContain("after update on orders");
  expect(trigger).toContain("deferrable initially deferred for each row");
  expect(trigger).toContain("when ((old.account_id is not null or new.account_id is not null) and");
  expect(trigger).toContain("is distinct from");
  for (const version of ["old", "new"]) {
    for (const field of moneyFields) {
      expect(trigger).toContain(`${version}.${field}`);
    }
    expect(trigger).toContain(`${version}.status = 'cancelled'`);
  }
  expect(trigger).not.toMatch(/\b(?:old|new)\.status\s*[,)]/);
  expect(trigger).toContain("execute function public.check_account_journal_v1()");
  expect(schema).toContain("check_account_journal after insert or delete on orders");
  expect(schema).toContain("array['payments', 'order_adjustments', 'account_movements']");
  // Reapplication replaces the old broad trigger, and drop.sql cascades both.
  expect(schema).toContain("drop trigger if exists check_account_journal on orders;");
  expect(schema).toContain("drop trigger if exists check_account_journal_order_update on orders;");
  expect(readFileSync("supabase/drop.sql", "utf8")).toContain("drop function if exists public.check_account_journal_v1() cascade;");
});

it.each(moneyFields)("planted: omitting %s from either order version breaks the schema contract", field => {
  for (const version of ["old", "new"]) {
    // Mutate only the UPDATE trigger, rather than an earlier function's SQL.
    const trigger = update(schema).replace(`${version}.${field},`, "");
    expect(trigger).not.toBe(update(schema));
    expect(() => moneyOrderUpdates(schema.replace(update(schema), trigger))).toThrow();
  }
});

it("planted: ordinary kitchen stages and non-account updates cannot queue journal checks", () => {
  for (const [before, after] of [
    ["old.status = 'cancelled'", "old.status"],
    ["(old.account_id is not null or new.account_id is not null) and", ""],
  ]) {
    const trigger = update(schema).replace(before, after);
    expect(trigger).not.toBe(update(schema));
    expect(() => moneyOrderUpdates(schema.replace(update(schema), trigger))).toThrow();
  }
});

// The cache is only sound if a write AFTER an account was reconciled forgets
// it: finish_payment_allocation updates payments at commit, after the
// journal check of that same payment may already have run.
function forgetsOnWrite(sql: string): void {
  const body = sql.split("create or replace function public.forget_account_journal_check_v1()")[1]?.split("$$;")[0] ?? "";
  expect(body).toContain("array_remove(array_remove(v_checked::uuid[], v_old), v_new)");
  const block = sql.split("create or replace function public.forget_account_journal_check_v1()")[1] ?? "";
  expect(block).toMatch(/array\['payments', 'order_adjustments', 'account_movements', 'customer_accounts'\]/);
  const triggers = block.match(/create trigger forget_account_journal_check[^;]*;/g) ?? [];
  // Immediate, never deferred: it must run as the late write happens.
  expect(triggers.length).toBe(3);
  for (const t of triggers) expect(t).not.toMatch(/deferr/);
  const orderUpdate = triggers.find(t => t.includes("forget_account_journal_check_update")) ?? "";
  const when = (t: string): string => t.replace(/\s+/g, " ").split(" when ")[1]?.split(" execute ")[0] ?? "missing";
  expect(when(orderUpdate)).toBe(when(`x when ${update(sql).split(" when ")[1] ?? ""} execute`).replace(/\s+/g, " "));
}

it("forgets a reconciled account when a later write in the same transaction touches it", () => {
  forgetsOnWrite(schema);
});

it("planted: a missing, deferred or narrower forget trigger breaks the cache's soundness", () => {
  for (const [before, after] of [
    ["array_remove(array_remove(v_checked::uuid[], v_old), v_new)", "v_checked::uuid[]"],
    ["create trigger forget_account_journal_check_update after update on orders\n  for each row",
      "create trigger forget_account_journal_check_update after update on orders\n  deferrable initially deferred for each row"],
    ["array['payments', 'order_adjustments', 'account_movements', 'customer_accounts'] loop\n    execute format('drop trigger if exists forget",
      "array['payments', 'order_adjustments', 'account_movements'] loop\n    execute format('drop trigger if exists forget"],
  ]) {
    const planted = schema.replace(before, after);
    expect(planted).not.toBe(schema);
    expect(() => forgetsOnWrite(planted)).toThrow();
  }
});
