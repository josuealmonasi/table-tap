import { describe, expect, it } from "vitest";
import type { TableBill } from "@/lib/table-bill";
import type { AppliedCoupon } from "@/lib/pricing";
import { billAmounts } from "@/lib/bill-amounts";

const side = (total: number, discount = 0, service = 0, tip = 0) =>
  ({ orders: [], items: [], total, discount, service, tip }) as unknown as TableBill["mine"];
const bill = {
  mine: side(44, 0, 4),
  others: side(56, 5, 0, 6),
  paid: side(0),
  total: 100,
  discount: 5,
  service: 4,
  tip: 6,
  settled: false,
} as unknown as TableBill;

describe("what the part of a bill being paid comes to", () => {
  it("adds up, line by line, to exactly what the button charges", () => {
    const a = billAmounts(bill, "all", null, 10, null);
    expect(a.dishes + a.service + a.priorTip).toBeCloseTo(a.food, 2);
    expect(a.total).toBeCloseTo(a.base + a.tip, 2);
    expect(a.tip).toBe(10); // ten percent of a hundred
    expect(a.discount).toBe(5); // what the floor already took off is still shown
  });

  it("works out only this phone's part when paying for their own", () => {
    const a = billAmounts(bill, "mine", null, 0, null);
    expect([a.food, a.service, a.dishes, a.servicePct]).toEqual([44, 4, 40, 10]);
  });

  it("takes a coupon off before the tip is worked out, and caps an exact tip at what is owed", () => {
    const coupon = { code: "OFF-010", kind: "fixed", value: 10 } as unknown as AppliedCoupon;
    const a = billAmounts(bill, "all", coupon, 10, null);
    expect(a.couponOff).toBe(10);
    expect(a.base).toBe(90);
    expect(a.tip).toBe(9);
    expect(billAmounts(bill, "all", null, 0, 500).tip).toBe(100);
  });
});
