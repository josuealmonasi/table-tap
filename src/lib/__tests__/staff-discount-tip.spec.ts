import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { billTotal, spreadDiscount } from "@/lib/staff-discount";
import { applyCoupon } from "@/lib/pricing";
import type { Order } from "@/lib/types";

const order = (id: string, total: number, tip: number) => ({ id, total, tip }) as Order;
it("N2: a full principal discount leaves the existing gratuity owed", () => {
  const orders = [order("a", 120, 20)];
  expect(billTotal(orders)).toBe(100);
  expect(spreadDiscount(orders, 120)).toEqual([{ orderId: "a", amount: 100, total: 20 }]);
});
it("N2: percentage discounts and their shares exclude gratuities", () => {
  const orders = [order("a", 120, 20), order("b", 50, 0), order("tip-only", 10, 10)];
  const amount = applyCoupon({ kind: "percent", value: 50 } as Parameters<typeof applyCoupon>[0], billTotal(orders));
  expect(amount).toBe(75);
  expect(spreadDiscount(orders, amount).map(s => s.total)).toEqual([70, 25, 10]);
});
it.each(["apply_bill_discount", "approve_discount_request_v2"])("N2: %s prices and distributes only locked principal", name => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const start = schema.lastIndexOf(`create or replace function public.${name}(`);
  const body = schema.slice(start, schema.indexOf("$$;", start));
  expect(body).toContain("sum(greatest(total - tip, 0))");
  expect(body).toContain("p_amount * 100 * greatest(total - tip, 0) / v_total");
  expect(body).toContain("o.total - a.amount < o.tip");
});
