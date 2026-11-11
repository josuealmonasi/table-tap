import { expect, it, vi } from "vitest";
import { shiftOtherCurrencies, type CashShift, type ShiftView } from "@/lib/cash-shift";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
import { shiftSumOf } from "@/lib/cash-shift-server";
it("carries both unclassified totals as numbers without recomputing sales or expected", async () => {
  rpc.mockResolvedValue({ data: { opening: "100", cashSales: "50", tips: "5", unclassifiedCash: "35",
    unclassifiedCashByCurrency: { MXN: "35", USD: "7" }, withdrawn: "10", expected: "175" }, error: null });
  expect(await shiftSumOf("restaurant", { id: "shift" } as CashShift)).toEqual({ opening: 100, cashSales: 50, tips: 5,
    unclassifiedCash: 35, unclassifiedCashByCurrency: { MXN: 35, USD: 7 }, withdrawn: 10, expected: 175 });
});
it("combines foreign retained cash with existing takings, including a currency with no sales", () => {
  const view: ShiftView = { shift: { id: "shift", currency: "MXN", opened_by: "cashier", opened_at: "2026-11-11T08:00:00Z",
    opening_amount: 100, closed_by: null, closed_at: null, counted_cash: null, expected_cash: null,
    difference: null, difference_note: null, explained_by: null },
    sum: { opening: 100, cashSales: 50, withdrawn: 10, expected: 175, unclassifiedCashByCurrency: { MXN: 35, USD: 7, EUR: 4, CAD: 0 } },
    otherCurrencies: [{ currency: "USD", cash: 2, card: 3 }], withdrawals: [], trail: [] };
  const before = structuredClone(view);
  expect(shiftOtherCurrencies(view)).toEqual([{ currency: "EUR", cash: 4, card: 0 }, { currency: "USD", cash: 9, card: 3 }]);
  expect(view).toEqual(before);
});
