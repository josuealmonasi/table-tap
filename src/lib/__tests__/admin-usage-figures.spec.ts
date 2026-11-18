import { expect, it } from "vitest";
import { usageFigures, usageWindows } from "@/lib/admin-usage-figures";

it("keeps sales, tips, returns and payment methods in their own currencies and dates", () => {
  const result = usageFigures({
    orders: [{ id: "o", currency: "MXN", total: 80, tip: 10, service_fee: 0, items: [], created_at: "2026-11-04T12:00:00Z", return_components: { total: 20, tip: 2, service_fee: 0 } }],
    payments: [{ currency: "MXN", amount: 100, method: "cash", created_at: "2026-11-04T12:00:00Z" }],
    returns: [{ currency: "MXN", amount_cents: 2000, tip_cents: 200, succeeded_at: "2026-11-05T12:00:00Z", kind: "return" }],
    fees: [{ currency: null, cents: 400, refunded_cents: 100, settled_at: "2026-11-05T12:00:00Z" }],
  }, "2026-11-01T06:00:00Z", "2026-12-01T06:00:00Z");
  expect(result.orders).toBe(1);
  expect(result.sales).toEqual([{ currency: "MXN", amount: 70 }]);
  expect(result.tips).toEqual([{ currency: "MXN", amount: 10 }]);
  expect(result.payments).toEqual([{ currency: "MXN", cash: 100, card: 0 }]);
  expect(result.fees).toEqual([{ currency: null, amount: 3 }]);
});

it("uses Mexico City calendar boundaries for both windows", () => {
  expect(usageWindows(new Date("2026-11-01T05:59:00Z"))).toEqual({
    last30: "2026-10-02T06:00:00.000Z", month: "2026-10-01T06:00:00.000Z", end: "2026-11-01T05:59:00.000Z",
  });
});
