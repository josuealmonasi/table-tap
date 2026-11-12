import { expect, it } from "vitest";
import { read, walkAll } from "./helpers";

const writers = ["account_journal_backfill_v1", "account_charge_v2",
  "append_account_collection_v1", "append_account_credit_movement_v1"];
function insertingFunctions(sql: string): string[] {
  return [...sql.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\$\$;/gi)]
    .filter(match => /insert\s+into\s+(?:public\.)?account_movements\b/i.test(match[0])).map(match => match[1]);
}
it("only reviewed transaction writers insert journal rows", () => {
  expect(insertingFunctions(read("supabase/schema.sql")).sort()).toEqual([...writers].sort());
  for (const name of writers.slice(2)) {
    expect(read("supabase/schema.sql")).toContain(`revoke all on function public.${name}(uuid) from public, anon, authenticated, service_role`);
  }
});
it("production application sources keep the existing order/payment readers", () => {
  const files = walkAll("src").filter(file => !file.includes("/__tests__/"));
  expect(files.filter(file => /\baccount_movements\b|\baccount_journal_backfill_v1\b/.test(read(file)))).toEqual([]);
});
it("sabotage: a new SQL writer cannot hide behind an approved caller", () => {
  const rogue = "create or replace function public.rogue() returns void as $$ begin insert into public.account_movements values (1); end $$;";
  expect(insertingFunctions(rogue)).toEqual(["rogue"]);
  expect(insertingFunctions(rogue).filter(name => !writers.includes(name))).toEqual(["rogue"]);
});
it("only the reviewed callers reach the private append helpers", () => {
  const sql = read("supabase/schema.sql");
  const callers = (name: string): string[] => [...sql.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\$\$;/gi)]
    .filter(match => match[1] !== name && match[0].includes(`public.${name}(`)).map(match => match[1]).sort();
  expect(callers("append_account_collection_v1")).toEqual(["account_checkout_settle_v2", "account_settle_currency_v1", "account_settle_v2"]);
  expect(callers("append_account_credit_movement_v1")).toEqual(["account_credit_v1", "cancel_order_v2", "prepare_order_refund"]);
});

it("no top-level or other SQL file bypasses the reviewed functions", () => {
  for (const file of walkAll("supabase").filter(file => file.endsWith(".sql"))) {
    const outsideFunctions = read(file).replace(/create or replace function public\.\w+\([\s\S]*?\$\$;/gi, "");
    expect(outsideFunctions, file).not.toMatch(/insert\s+into\s+(?:public\.)?account_movements\b/i);
  }
});
