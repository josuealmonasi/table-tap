import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const schema = readFileSync("supabase/schema.sql", "utf8");
const definition = (name: string) => schema.split(`create or replace function public.${name}(`)[1].split("$$;")[0];
const credit = definition("account_credit_v1");
it("locks restaurant, account, then order and rechecks eligibility before writing", () => {
  const locks = ["lock_restaurant_money(p_restaurant)", "id = v_account for update", "id = p_order for update"];
  expect(locks.map(x => credit.indexOf(x))).toEqual([...locks.map(x => credit.indexOf(x))].sort((a, b) => a - b));
  for (const x of locks) expect(credit).toContain(x);
  expect(credit).toContain("o.account_id is distinct from a.id or o.paid or o.written_off");
  expect(credit).toContain("o.status in ('cancelled', 'pending_payment')");
  expect(credit).toContain("unresolved_account_page_v1(p_restaurant, a.id) or a.checkout_until > now()");
  expect(credit.indexOf("(d.request - 'account') is distinct from v_request")).toBeLessThan(credit.indexOf("id = v_account for update"));
  expect(credit.indexOf("v_total <> p_expected_cents")).toBeLessThan(credit.indexOf("insert into order_adjustments"));
});
it("keeps the exact return component apportionment, including food-first ties and bigint multiplication", () => {
  const rule = (s: string) => s.slice(s.indexOf("  v_f := v_p - v_service;"), s.indexOf("\n  insert into order_adjustments"))
    .replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
  expect(rule(credit)).toBe(rule(definition("return_on_order_v1")));
  expect(credit).toContain("v_pr := least(p_amount_cents, v_p); v_tr := p_amount_cents - v_pr");
});
it("stores the full immutable request and snapshots, with no receipt or paid flag", () => {
  expect(credit).toContain("previous_total, previous_tip, previous_service_fee");
  expect(credit).toContain("resulting_total, resulting_tip, resulting_service_fee, forgiven, amount_cents, currency");
  expect(credit).toContain("reason, note, actor, request_id, request");
  expect(credit).toContain("written_off = (d.resulting_total = 0)");
  expect(credit).not.toMatch(/paid\s*=\s*true|insert into payments|release_stock|restock/i);
  expect(schema).toContain("old.kind in ('forgive', 'return', 'account_credit')");
  expect(schema).toContain("on order_adjustments (restaurant_id, request_id) where kind = 'account_credit'");
  expect(schema).toContain("on order_adjustments (order_id) where kind = 'cancel'");
});
it("has service-only grants, fixed search path, drop parity and original till replay", () => {
  const signature = "public.account_credit_v1(uuid, uuid, numeric, numeric, text, text, text, uuid)";
  expect(credit).toContain("security definer set search_path = public");
  expect(schema).toContain(`revoke all on function ${signature} from public, anon, authenticated`);
  expect(schema).toContain(`grant execute on function ${signature} to service_role`);
  expect(readFileSync("supabase/drop.sql", "utf8")).toContain(`drop function if exists ${signature}`);
  expect(definition("pos_ticket")).toContain("a.kind in ('return', 'account_credit')");
});

it("freezes a legacy ceiling currency before fully crediting its last charge", () => {
  expect(credit).toContain("where id = a.id and restaurant_id = p_restaurant and credit_currency is null");
  expect(credit.indexOf("update customer_accounts set credit_currency")).toBeLessThan(credit.indexOf("update orders set total"));
  expect(credit).toContain("jsonb_build_object('account', a.id)");
});
