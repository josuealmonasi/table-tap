import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spreadDiscount } from "@/lib/staff-discount";
import { couponBase } from "@/lib/coupon-base";
import { applyCoupon } from "@/lib/pricing";
import type { Order } from "@/lib/types";

const order = (id: string, total: number, tip: number) => ({ id, total, tip }) as Order;
it("N2: a full principal discount leaves the existing gratuity owed", () => {
  const orders = [order("a", 120, 20)];
  expect(couponBase(orders)).toBe(100);
  expect(spreadDiscount(orders, 120)).toEqual([{ orderId: "a", amount: 100, total: 20 }]);
});
it("N2: percentage discounts and their shares exclude gratuities", () => {
  const orders = [order("a", 120, 20), order("b", 50, 0), order("tip-only", 10, 10)];
  const amount = applyCoupon({ kind: "percent", value: 50 } as Parameters<typeof applyCoupon>[0], couponBase(orders));
  expect(amount).toBe(75);
  expect(spreadDiscount(orders, amount).map(s => s.total)).toEqual([70, 25, 10]);
});
it.each(["apply_bill_discount_v2", "approve_discount_request_v3"])("N2: %s prices and distributes only the dishes", name => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const start = schema.lastIndexOf(`create or replace function public.${name}(`);
  const body = schema.slice(start, schema.indexOf("$$;", start));
  expect(body).toContain("sum(greatest(total - tip - service_fee, 0))");
  expect(body).toContain("p_amount * 100 * greatest(total - tip - service_fee, 0) / v_total");
  expect(body).toContain("mod(p_amount * 100 * greatest(total - tip - service_fee, 0), v_total)");
  expect(body).toContain("o.total - a.amount < o.tip + o.service_fee");
  expect(body).not.toContain("total - tip,");
});
it("2026-11-26: a staff discount leaves the service charge owed in full", () => {
  const orders = [{ id: "a", total: 135, tip: 20, service_fee: 15 }] as Order[];
  expect(couponBase(orders)).toBe(100);
  expect(spreadDiscount(orders, 500)).toEqual([{ orderId: "a", amount: 100, total: 35 }]);
});
