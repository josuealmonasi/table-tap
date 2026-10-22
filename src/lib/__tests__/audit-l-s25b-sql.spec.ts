import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync("supabase/schema.sql", "utf8");
const fn = (name: string) => sql.slice(sql.lastIndexOf(`create or replace function public.${name}(`)).split("$$;")[0];

it("L3 keeps unapproved cash and unfinished fee shares before deletion, then archives approved receipts", () => {
  const body = fn("admin_delete_restaurant");
  expect(body).toContain("from offline_sale_queue where restaurant_id = p_restaurant and approved_at is null");
  expect(body).toContain("'outcome', 'offlineSale'");
  expect(body).toContain("'outcome', 'refundFee'");
  expect(body).toContain("fee_reconciled_at is null");
  expect(body).toContain("f.refunded_cents <");
  expect(body).toContain("round(");
  expect(body).toContain("d.fee_request->>'amount'");
  expect(body).toContain("'offline_sale_queue', q.pos_ref, to_jsonb(q)");
  expect(body.indexOf("'outcome', 'refundFee'")).toBeLessThan(body.indexOf("if p_check_only"));
});

it("L4 compares a purchase's original packs, ingredient and total before returning its id", () => {
  const body = fn("record_purchase_once");
  expect(body).toContain("p.request_packs");
  expect(body).toContain("p.ingredient_id");
  expect(body).toContain("p.total");
  expect(body).toContain("errcode = 'PT409'");
  expect(body.indexOf("errcode = 'PT409'")).toBeLessThan(body.indexOf("return p.id"));
  const writer = fn("record_purchase_once_v2");
  expect(writer).toContain("v_previous is null");
  expect(writer.indexOf("record_purchase_once(p_restaurant")).toBeLessThan(writer.indexOf("insert into user_logs"));
  expect(writer).toContain("insert into user_logs");
  expect(sql).toContain("revoke all on function public.record_purchase_once_v2(uuid, uuid, numeric, numeric, text, uuid) from public, anon, authenticated;");
  expect(readFileSync("supabase/drop.sql", "utf8")).toContain("drop function if exists public.record_purchase_once_v2(uuid, uuid, numeric, numeric, text, uuid);");
});

it.each(["record_waste_once", "record_ingredient_counts_once", "create_cash_withdrawal_once", "close_cash_shift_once"])("L4 %s refuses a changed saved request", name => {
  expect(fn(name)).toContain("errcode = 'PT409'");
  expect(fn(name)).toContain("is distinct from");
});

it("L4 account sales compare the saved account and request before answering with a ticket", () => {
  const body = fn("ring_pos_account_v2");
  expect(body).toContain("request_scope");
  expect(body).toContain("is distinct from p_account");
  expect(body.indexOf("request_scope")).toBeLessThan(body.indexOf("return v_ticket"));
});

it("L8 all ingredient RPC writes acquire movement lock before row locks and foreign keys", () => {
  for (const name of ["record_waste", "record_waste_once", "record_purchase", "record_purchase_once", "record_ingredient_counts", "record_ingredient_counts_once"]) {
    const body = fn(name);
    const lock = body.indexOf("perform public.lock_ingredient_movements");
    expect(lock, name).toBeGreaterThan(-1);
    for (const token of ["from ingredients", "insert into waste_entries", "insert into ingredient_purchases", "insert into ingredient_counts"]) {
      if (body.includes(token)) expect(lock, `${name}: ${token}`).toBeLessThan(body.indexOf(token));
    }
  }
});

it("L tiers_sound refuses zero prices in the database CHECK too", () => {
  expect(fn("tiers_sound")).toContain("(t->>'price')::numeric <= 0");
  expect(sql).toContain("check (public.tiers_sound(tiers))");
});

it("batch 5 cross-review 3: rows saved before the request was saved still replay", () => {
  // Purchases without packs match on ingredient and money; account sales
  // without a scope match on their account. Refused, the clients in
  // production forgot the reference and recorded MX$100 twice.
  const purchase = fn("record_purchase_once");
  expect(purchase).toContain("p.request_packs is not null and p.request_packs is distinct from p_packs");
  expect(purchase).not.toMatch(/\(p\.ingredient_id, p\.request_packs, p\.total\) is distinct from/);
  const account = fn("ring_pos_account_v2");
  expect(account).toContain("o.request_scope is not null and o.request_scope is distinct from p_order->>'request_scope'");
  expect(account).not.toMatch(/or o\.request_scope is distinct from p_order->>'request_scope'\n/);
});

it("batch 5 cross-review 4: a saved provider fee request blocks deletion even beside a fee ledger row", () => {
  // A MX$100 charge refunded in full outside the app: MX$3 of fee to return,
  // a local share that rounds to zero, and a fee row with charge_cents > 0.
  const body = fn("admin_delete_restaurant");
  expect(body).not.toContain("f.charge_cents > 0 or f.refunded_cents = f.cents");
  expect(body).toMatch(/coalesce\(\(d\.fee_request->>'amount'\)::numeric, 0\) > 0[\s\S]*and f\.refunded_cents = f\.cents\)/);
});
