import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
const drop = readFileSync("supabase/drop.sql", "utf8");
const definitions = new Map([...schema.matchAll(/create or replace function public\.(\w+)\(/g)]
  .map(m => [m[1], schema.slice(m.index).split("$$;")[0]]));
const body = (name: string) => definitions.get(name)!;

it("F1: every online payment is dated after its money lock, not at transaction start", () => {
  const missing: string[] = [];
  let checked = 0;
  for (const [name, sql] of definitions) {
    for (const insert of sql.matchAll(/insert into payments\s*\(([^)]+)\)([\s\S]*?);/g)) {
      if (name.startsWith("settle_offline_sale")) continue;
      checked++;
      const locked = sql.indexOf("perform public.lock_restaurant_money(") >= 0
        && sql.indexOf("perform public.lock_restaurant_money(") < insert.index!;
      if (!locked || !insert[1].includes("created_at") || !insert[2].includes("clock_timestamp()")) missing.push(name);
    }
  }
  expect([...new Set(missing)], "Online writers still use the transaction-start payment date").toEqual([]);
  expect(checked).toBe(20);
});

it("F1: offline receipts retain their explicit sale time; drawer totals still include gross cash", () => {
  for (const name of ["settle_offline_sale", "settle_offline_sale_v2"]) {
    expect(body(name)).toMatch(/actor_email, created_at\)\s*values \(p_restaurant, p_order, round\(v_total, 2\), p_method, p_actor, p_at\)/);
  }
  expect(body("cash_shift_totals")).toContain("coalesce(sum(p.amount), 0)");
  expect(body("cash_shift_totals")).toContain("p.created_at between s.opened_at and s.until_at");
});

it("F2: held cash is rechecked under the queue writer's lock before signing a shift", () => {
  const close = body("close_cash_shift");
  const lock = close.indexOf("perform public.lock_restaurant_money(p_restaurant);");
  const check = close.indexOf("from offline_sale_queue");
  const sum = close.indexOf("v_sum := public.cash_shift_totals");
  expect(lock >= 0 && check > lock && check < sum, "Held-cash recheck is missing inside the closing transaction").toBe(true);
  for (const scope of ["restaurant_id = p_restaurant", "approved_at is null", "body->>'method' = 'cash'",
    "'outcome', 'held_cash'", "'waiting', v_waiting"]) expect(close).toContain(scope);
  expect(close.indexOf("'outcome', 'held_cash'")).toBeLessThan(close.indexOf("update cash_shifts"));
  const queue = body("queue_offline_sale");
  expect(queue).toContain("perform public.lock_restaurant_money(p_restaurant);");
  expect(queue.indexOf("perform public.lock_restaurant_money(p_restaurant);")).toBeLessThan(queue.indexOf("insert into offline_sale_queue"));
  const once = body("close_cash_shift_once");
  expect(once.indexOf("return s.close_result")).toBeLessThan(once.indexOf("public.close_cash_shift("));
  expect(once).toContain("if v_result->>'outcome' = 'held_cash' then return v_result; end if;");
});

it("F1/F2: modified SQL objects retain service-only grants and teardown parity", () => {
  for (const signature of ["close_cash_shift(uuid, uuid, numeric, text)",
    "close_cash_shift_once(uuid, uuid, numeric, text, uuid)"]) {
    expect(schema).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
    expect(schema).toContain(`grant execute on function public.${signature} to service_role;`);
    expect(drop).toContain(`drop function if exists public.${signature};`);
  }
});
