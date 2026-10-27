import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync("supabase/schema.sql", "utf8");
const fn = (name: string) => sql.slice(sql.lastIndexOf(`create or replace function public.${name}(`)).split("$$;")[0];

it.each(["finish_refund_due_attempt", "finish_refund_operation"])("finding 2: %s commits pending fee verification with customer completion", name => {
  expect(fn(name)).toContain("fee_verification_pending");
  expect(sql).toContain(`alter table ${name === "finish_refund_operation" ? "refund_operations" : "refunds_due"} add column if not exists fee_verification_pending boolean not null default true;`);
});

it("finding 2: deletion refuses unknown fee targets for both refund ledgers before archiving", () => {
  const body = fn("admin_delete_restaurant");
  expect(body).toContain("'outcome', 'refundFeeVerification'");
  expect(body).toContain("d.fee_verification_pending");
  expect(body).toContain("r.fee_verification_pending");
  expect(body.indexOf("'outcome', 'refundFeeVerification'")).toBeLessThan(body.indexOf("if p_check_only"));
});

it("finding 4: advancing an attempt compares the saved request under the money lock and keeps history", () => {
  const body = fn("advance_refund_due_fee");
  expect(body).toContain("lock_restaurant_money(p_restaurant)");
  expect(body).toContain("d.fee_request is distinct from p_previous");
  expect(body).toContain("fee_request_history");
  expect(body).toContain("fee_target_cents");
  expect(body).toContain("p_target - p_returned");
  expect(sql).toContain("revoke all on function public.advance_refund_due_fee(uuid, uuid, jsonb, int, int, int, text) from public, anon, authenticated;");
  expect(readFileSync("supabase/drop.sql", "utf8")).toContain("drop function if exists public.advance_refund_due_fee(uuid, uuid, jsonb, int, int, int, text);");
});

it("legacy rows need saved no-fee checkout evidence or a fee returned in full, never missing evidence or local rounding", () => {
  const clear = fn("refund_fee_proven_clear");
  expect(clear).toContain("f.refunded_cents = f.cents");
  expect(clear).toContain("from diner_checkouts c");
  expect(clear).toContain("c.metadata->>'fee_cents'");
  expect(clear).toContain("payment_intent_data,application_fee_amount");
  expect(clear).toContain("and not exists (select 1 from platform_fees");
  expect(clear).not.toContain("round(");
  expect(sql).toContain("public.refund_fee_proven_clear(d.restaurant_id, d.stripe_payment_intent)");
  expect(sql).toContain("public.refund_fee_proven_clear(r.restaurant_id, r.stripe_payment_intent)");
});

it("order fee verification keeps a short return pending and excludes refunds completed after its provider snapshot", () => {
  const verify = fn("apply_verified_platform_fee");
  expect(verify).toContain("lock_restaurant_money(p_restaurant)");
  expect(verify).toContain("fee_verification_pending = (v_returned < greatest(coalesce(fee_target_cents, 0), p_target))");
  expect(verify).toContain("stripe_refund_id = any(p_refunds)");
  expect(fn("sync_refunded_platform_fee")).not.toContain("update refund_operations");
});

it("unknown-fee deletion has its own admin refusal in both languages", () => {
  expect(readFileSync("src/app/api/admin/restaurants/route.ts", "utf8"))
    .toContain('refundFeeVerification: "apiErr.restaurantDeleteRefundFeeVerification"');
  for (const locale of ["en", "es"]) expect(readFileSync(`src/lib/i18n/${locale}.ts`, "utf8"))
    .toContain("restaurantDeleteRefundFeeVerification:");
});

it("the immutable-money trigger permits fee verification metadata while preserving amounts and charge identity", () => {
  const body = fn("guard_return_money");
  const exclusions = [...body.matchAll(/to_jsonb\((?:new|old)\) - array\[([^\]]+)\]/g)].map(match => match[1]);
  expect(exclusions).toHaveLength(2);
  for (const excluded of exclusions) {
    expect(excluded).toContain("'fee_verification_pending'");
    expect(excluded).toContain("'fee_target_cents'");
    for (const money of ["amount", "tip", "currency", "stripe_payment_intent", "stripe_account_id"])
      expect(excluded).not.toContain(`'${money}'`);
  }
});
