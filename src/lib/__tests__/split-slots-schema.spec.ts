import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// The SQL half of split by people, model 2 (contract:
// tabletap-release/loop/dialogue/split-slots-contract.md). Every function was
// replayed on dev Postgres in rolled-back transactions; these pin the rules.
const sql = readFileSync("supabase/schema.sql", "utf8");
const drop = readFileSync("supabase/drop.sql", "utf8");
const body = (name: string) => sql.slice(sql.lastIndexOf(`create or replace function public.${name}(`)).split("$$;")[0];

const SERVER_ONLY = [
  "start_bill_split_v2(uuid, uuid, uuid, uuid, int, int, text, uuid, int)",
  "resize_bill_split_v2(uuid, uuid, int, text, int)",
  "cancel_bill_split_v2(uuid, uuid, int, text)",
  "reserve_split_slots_v1(uuid, uuid, int, uuid, int[], uuid)",
  "release_split_slots_v1(uuid, uuid)",
  "collect_split_slots_v1(uuid, uuid, int, int[], int, text, int, text, text, text)",
  "settle_split_slots_v1(uuid, uuid, text, int)",
];

it("every slot writer takes the money lock first and is callable by the server only", () => {
  for (const fn of SERVER_ONLY) {
    const name = fn.split("(")[0];
    expect(body(name), name).toMatch(/^[\s\S]*?begin[\s\S]*?perform public\.lock_restaurant_money\(p_restaurant\);/);
    expect(sql, name).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
    expect(sql, name).toContain(`grant execute on function public.${fn} to service_role;`);
    expect(drop, name).toContain(`drop function if exists public.${fn};`);
  }
});

it("slots exist at once, add up to the frozen debt, and the fee is capped at 5% of the food", () => {
  const start = body("start_bill_split_v2");
  expect(start).toContain("public.split_cents(v_debt.debt_cents, p_shares, s)");
  expect(start).toContain("v_fee := least(p_flat_fee_cents, floor(v_debt.food_cents * 0.05)::int);");
  expect(start).toContain("if v_debt.debt_cents <> p_expected_cents then");
});

it("N freezes at the first attempt; a stale revision changes nothing", () => {
  for (const name of ["resize_bill_split_v2", "cancel_bill_split_v2"]) {
    expect(body(name), name).toContain("v_split.first_payment_attempt_at is not null");
    expect(body(name), name).toContain("if v_split.revision <> p_revision then");
  }
  expect(body("reserve_split_slots_v1")).toContain("first_payment_attempt_at = coalesce(first_payment_attempt_at, now())");
});

it("a slot is never paid twice nor freed after it was paid", () => {
  expect(body("reserve_split_slots_v1")).toContain("'outcome', 'taken'");
  expect(body("collect_split_slots_v1")).toContain("'outcome', 'reserved'");
  expect(body("release_split_slots_v1")).toContain("and reserved_checkout_id = p_checkout and payment_id is null");
  // A late card payment for slots no longer its own is owed back.
  expect(body("settle_split_slots_v1")).toContain("insert into refunds_due");
  // The other collections refuse instead of cancelling a split with money in it.
  for (const name of ["collect_table_reviewed_v1", "collect_on_sitting_v2"]) {
    expect(body(name), name).toContain("(s.payment_id is not null or s.reserved_checkout_id is not null)");
  }
});

it("money is allocated at once, and the close never invents a pay method", () => {
  expect(body("collect_split_slots_v1")).toContain("perform public.allocate_receipt(v_payment);");
  expect(body("settle_split_slots_v1")).toContain("perform public.allocate_receipt(v_payment);");
  expect(body("close_divided_bill_v3")).toContain("pay_method = case when cardinality(v_methods) = 1 then v_methods[1] end");
  expect(sql).toContain("create trigger guard_split_checkout_slot before update on bill_split_checkout_slots");
});
