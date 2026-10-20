import { describe, expect, it } from "vitest";
import { tableBill } from "@/lib/table-bill";
import { billAmounts } from "@/lib/bill-amounts";
import { feeRate } from "@/lib/costs/fees";
import { depositDays } from "@/lib/terminal";
import type { Order } from "@/lib/types";

describe("allocated money stays consistent in financial readers", () => {
  it("shows only the remaining amount and tip to a diner", () => {
    const bill = tableBill([{ id: "dish", total: 100, tip: 10, collected: 40, collected_tip: 4,
      paid: false, written_off: false, status: "received", items: [] } as unknown as Order], ["dish"]);
    expect(bill.total).toBe(60);
    expect(bill.tip).toBe(6);
    expect(billAmounts(bill, "all", null, 0, null)).toMatchObject({ collected: 40, food: 60, total: 60, priorTip: 6 });
  });
  it("counts Stripe's fixed charge once across a multi-order receipt", () => {
    const result = feeRate([60, 40].map(amount => ({ amount, method: "card", stripe_payment_intent: "one-charge" })), 0, 3.5);
    expect(result.fees).toBeCloseTo((3.6 + 3) * 1.16);
  });
  it("deducts a confirmed partial terminal return on its return day", () => {
    const days = depositDays([
      { amount: 100, tip: 0, created_at: "2026-10-12T12:00:00Z" },
      { amount: 50, tip: 0, created_at: "2026-10-13T12:00:00Z" },
      { amount: 30, tip: 0, created_at: "2026-10-13T13:00:00Z", returned_at: "2026-10-13T13:00:00Z" },
    ], [], 3.5, 1, "UTC", "2026-10-14");
    expect(days.find(d => d.day === "2026-10-12")).toMatchObject({ takings: 100, expected: 96.5 });
    expect(days.find(d => d.day === "2026-10-13")).toMatchObject({ takings: 50, givenBack: 30, expected: 18.25 });
  });
});
