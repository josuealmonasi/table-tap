import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(f, "utf8");
const sql = read("supabase/schema.sql");
const fn = (name: string) => sql.split(`create or replace function public.${name}(`)[1]?.split("$$;")[0] ?? "";
it("E4 freezes each discounted entitlement before charging and applies it inside settlement", () => {
  expect(fn("diner_checkout_open")).toContain("order_discounts");
  expect(fn("settle_card_orders_v2")).toContain("order_discounts");
  expect(fn("settle_card_orders_v2")).toContain("card receipts exceed verified charge");
  expect(fn("diner_checkout_open")).toContain("v_entitled + v_tip");
  expect(fn("settle_card_orders_v2")).toContain("v_owed := round(p_charged - v_recorded, 2)");
  expect(fn("settle_card_orders_v2")).toContain("insert into refunds_due");
});
it("E7 expiry and confirmation address only their checkout's coupon reservation", () => {
  expect(sql).toContain("checkout_attempt_id uuid");
  expect(fn("finish_diner_checkout")).toContain("checkout_attempt_id = v_checkout.id");
  expect(read("src/lib/checkout-abandon.ts")).toContain("finishDinerCheckout(session, false)");
  expect(fn("abandon_checkout")).toContain("checkout_attempt_id is null");
  const cart = read("src/app/api/checkout/route.ts").split("const cur =")[1];
  expect(cart.indexOf("await logCheckoutCoupon(")).toBeLessThan(cart.indexOf("await openCardSession("));
});
it("E8 all pooled payment paths use the same fee-independent checkout exclusion", () => {
  for (const kind of ["bill", "split", "account"]) {
    expect(read(`src/app/api/${kind}/pay/route.ts`)).toContain("openDinerAttempt(");
  }
  expect(fn("diner_checkout_open")).toContain("lock_restaurant_money");
  expect(fn("diner_checkout_open")).toContain("order_ids &&");
  expect(sql).toContain("idempotency_key text");
  expect(fn("diner_checkout_open")).toContain("payable_order_ids <@ v_new.order_ids");
});
it("E9 freezes the split's food principal separately from tips", () => {
  expect(fn("join_bill_split_v2")).toContain("food_principal");
  expect(read("src/app/api/split/pay/route.ts")).toContain("split.food_principal");
  expect(sql).toContain("food_principal numeric");
  for (const kind of ["bill", "split", "account"]) {
    expect(read(`src/app/api/${kind}/pay/route.ts`)).toMatch(/foodPrincipal[: ,]/);
  }
});
it("E4 a concurrent partial collection allows only the attempt's frozen coupon reduction", () => {
  expect(fn("guard_allocated_order")).toContain("new.total >= v_covered");
  expect(fn("guard_allocated_order")).toContain("c.order_discounts->>old.id::text");
  expect(fn("guard_allocated_order")).toContain("allocated money requires an adjustment");
  expect(fn("settle_card_orders_v2")).toContain("least(v_discount.amount, greatest(o.total");
  expect(fn("settle_card_orders_v2")).toContain("set amount = v_applied where checkout_attempt_id = v_checkout.id");
});
it("E4 pay-now coupon audit amounts are not overwritten by an empty bill discount map", () => {
  expect(fn("settle_card_orders_v2")).toContain("v_checkout.order_discounts <> '{}'::jsonb");
});
it("E11 display and payment use one validated sitting, including old debt", () => {
  // Payment reads the sitting the table cookie proved, never one the client
  // names (#525), and with the member, so a closed sitting shows only the
  // phone's own food.
  const bill = read("src/app/api/bill/pay/route.ts");
  expect(bill).toContain('fetchTableBill(restaurantId, tableId, "diner", member.sessionId, member)');
  expect(bill).not.toContain('.gte("created_at", billWindowStart()');
  expect(read("src/hooks/useBillPayment.ts").split('fetch("/api/bill/pay"')[1]).toMatch(/sessionId/);
});
