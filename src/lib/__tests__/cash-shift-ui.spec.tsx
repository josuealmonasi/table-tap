import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import type { ShiftView } from "@/lib/cash-shift";

vi.stubGlobal("React", React);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/i18n/context", () => ({ useLocale: () => ({ locale: "en" }), useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor("en"), key, vars) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => () => {} }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const { default: ShiftRecord } = await import("@/components/dashboard/cash/ShiftRecord");
const { default: ShiftBlock } = await import("@/components/dashboard/cash/ShiftBlock");
const { default: PosCashDrawer } = await import("@/components/dashboard/pos/PosCashDrawer");
const view: ShiftView = {
  shift: { id: "shift", currency: "MXN", opened_at: "2026-10-20T22:00:00Z", closed_at: "2026-10-21T02:00:00Z", opening_amount: 100,
    opened_by: "cashier", closed_by: "cashier", counted_cash: 100, expected_cash: 80, difference: 20, difference_note: null, explained_by: null },
  sum: { opening: 100, cashSales: 0, withdrawn: 20, expected: 80 }, withdrawals: [], trail: [],
};
it("I2 displays a closed shift in its stored currency and includes dates for an overnight handover", () => {
  const html = renderToStaticMarkup(<ShiftRecord view={view} timeZone="UTC" restaurantName="Cafe" />);
  expect(html).toContain("MX$80.00");
  expect(html).toContain("10/20/26"); expect(html).toContain("10/21/26");
});
it("I2 shows the old drawer currency in manager totals, withdrawal input and the blind close", () => {
  const open = { ...view, shift: { ...view.shift, closed_at: null } };
  const html = renderToStaticMarkup(<ShiftBlock shifts={[open]} currency="USD" timeZone="UTC" restaurantName="Cafe" />);
  expect(html).toContain("MX$80.00");
  expect(html).toContain("Cash counted · MXN");
  expect(html).toContain("Amount · MXN");
  expect(html).toContain("count this shift in MXN");
});
it("I2 keeps closing available at the till after a menu currency switch", () => {
  const html = renderToStaticMarkup(<PosCashDrawer shiftOpen currency="USD" shiftCurrency="MXN" />);
  expect(html).toContain("The menu now uses USD");
  expect(html).toContain("Cash counted · MXN");
  expect(html).toContain("Close shift");
  expect(html).toMatch(/<button\b[^>]*>Close shift<\/button>/);
  expect(html).not.toMatch(/<button\b[^>]*disabled[^>]*>Close shift<\/button>/);
});
it("I2 explains the currency switch from the cashier's side in both languages", () => {
  for (const locale of ["en", "es"] as const) {
    const text = translate(messagesFor(locale), "shift.currencyChanged", { currency: "MXN", current: "USD" });
    expect(text).toContain("MXN"); expect(text).toContain("USD"); expect(text).not.toContain("shift.currencyChanged");
  }
});
