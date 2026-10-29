import { expect, it } from "vitest";
import { corteShiftRows } from "@/lib/corte-print";
import { formatMoney } from "@/lib/format";
import type { ShiftView } from "@/lib/cash-shift";

const shift = (currency: string): ShiftView => ({
  shift: { id: "s", currency, opened_by: "cashier", opened_at: "2026-10-28T12:00:00Z", opening_amount: 0, closed_by: "cashier",
    closed_at: "2026-10-28T20:00:00Z", counted_cash: 100, expected_cash: 100, difference: 0, difference_note: null, explained_by: null },
  sum: { opening: 0, cashSales: 100, withdrawn: 0, expected: 100 }, withdrawals: [], trail: [],
});

it("prints a peso shift in pesos after the restaurant switched to dollars (sweep 4, finding 3)", () => {
  const html = corteShiftRows([shift("MXN")], "USD", key => key);
  expect(html).toContain(formatMoney(100, "MXN"));
  expect(html).not.toContain(`>${formatMoney(100, "USD")}<`);
});
