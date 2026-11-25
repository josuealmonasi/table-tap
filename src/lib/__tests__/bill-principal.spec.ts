import { expect, it } from "vitest";
import fs from "node:fs";
import { billEntitlements, remainingPrincipal } from "@/lib/bill-principal";
import { billAmounts } from "@/lib/bill-amounts";
import { tableBill } from "@/lib/table-bill";
import { orderFeeCents, type PlanLimits } from "@/lib/plan";
import type { Order } from "@/lib/types";

it("E4 freezes ninety pesos of receipts for a hundred-peso bill with a ten-peso coupon", () => {
  const frozen = billEntitlements([{ id: "a", total: 40 }, { id: "b", total: 60 }], 10);
  expect(frozen).toEqual({ entitlements: { a: 36, b: 54 }, discounts: { a: 4, b: 6 } });
  expect(Object.values(frozen.entitlements).reduce((a, b) => a + b, 0)).toBe(90);
});
it("E4 allocates every cent, including a full discount and an order with only tips", () => {
  const frozen = billEntitlements([{ id: "a", total: 0.01 }, { id: "b", total: 0.02 }, { id: "tip", total: 1, tip: 1 }], 0.03);
  expect(frozen.entitlements).toEqual({ a: 0, b: 0, tip: 1 });
  expect(frozen.discounts).toEqual({ a: 0.01, b: 0.02, tip: 0 });
});
it("E4 coupon-free bill, account and split own orders retain every remaining cent", () => {
  expect(billEntitlements([{ id: "a", total: 100, tip: 10, collected: 30, collected_tip: 3 }], 0))
    .toEqual({ entitlements: { a: 70 }, discounts: { a: 0 } });
});
it("E9 existing and collected tips never raise the five-percent fee cap", () => {
  expect(remainingPrincipal([{ id: "a", total: 8, tip: 4 }])).toBe(4);
  expect(orderFeeCents({ order_fee: 0.75 } as PlanLimits, 100 * remainingPrincipal([{ id: "a", total: 8, tip: 4 }]))).toBe(20);
  expect(remainingPrincipal([{ id: "a", total: 8, tip: 4, collected: 3, collected_tip: 1 }])).toBe(2);
});
it("E4 coupon preview and the server freeze agree when the bill already has tips", () => {
  const orders = [{ id: "a", total: 8, tip: 4, items: [], paid: false, status: "received" }] as unknown as Order[];
  const displayed = billAmounts(tableBill(orders, []), "all", { code: "HALF", kind: "percent", value: 50, minSubtotal: 0 }, 0, null);
  const frozen = billEntitlements(orders, displayed.couponOff);
  expect(displayed.couponOff).toBe(2);
  expect(displayed.total).toBe(6);
  expect(frozen.entitlements.a).toBe(displayed.total);
});
it("never creates a negative food entitlement to hide an excessive discount", () => {
  expect(() => billEntitlements([{ id: "a", total: 8, tip: 4 }], 5)).toThrow("exceeds");
});
it("a coupon is judged and applied on the dishes alone, on the screen and in the pay route (security sweep 2026-11-24)", () => {
  // MX$90 of dishes + MX$15 service: a MX$100-minimum coupon must not apply,
  // and a 10% coupon takes MX$9 (of the dishes), not MX$10.50.
  const orders = [{ id: "a", total: 105, service_fee: 15, tip: 0, items: [], paid: false, status: "received" }] as unknown as Order[];
  const shown = billAmounts(tableBill(orders, []), "all", { code: "TEN", kind: "percent", value: 10, minSubtotal: 0 }, 0, null);
  expect(shown.dishes).toBe(90);
  expect(shown.couponOff).toBe(9);
  const route = fs.readFileSync("src/app/api/bill/pay/route.ts", "utf8");
  expect(route).toContain("couponProblem(coupon, dishes)");
  expect(route).toContain("applyCoupon(toAppliedCoupon(coupon), dishes)");
  expect(fs.readFileSync("src/components/customer/BillSheet.tsx", "utf8")).toContain("food={Math.max(0, amounts.dishes)}");
});
