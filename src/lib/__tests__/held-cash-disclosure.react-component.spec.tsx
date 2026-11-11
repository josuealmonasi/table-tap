// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate, type Locale } from "@/lib/i18n";
import type { ShiftView } from "@/lib/cash-shift";
const state = vi.hoisted(() => ({ locale: "en" as Locale, refresh: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/lib/i18n/context", () => ({ useLocale: () => ({ locale: state.locale }), useT: () =>
  (key: string, vars?: Record<string, string | number>) => translate(messagesFor(state.locale), key, vars) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => state.toast }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/components/dashboard/cash/CashMovementDialog", () => ({ default: () => null }));
vi.mock("@/components/dashboard/cash/CloseShiftDialog", () => ({ default: () => null }));
import ShiftBlock from "@/components/dashboard/cash/ShiftBlock";
import ShiftRecord from "@/components/dashboard/cash/ShiftRecord";
let host: HTMLDivElement, root: Root;
const view = (closed = false): ShiftView => ({
  shift: { id: "shift", currency: "MXN", opened_by: "cashier", opened_at: "2026-11-11T08:00:00Z",
    opening_amount: 100, closed_by: closed ? "manager" : null, closed_at: closed ? "2026-11-11T16:00:00Z" : null,
    counted_cash: 175, expected_cash: closed ? 175 : null, difference: 0, difference_note: null, explained_by: null },
  sum: { opening: 100, cashSales: 50, tips: 5, withdrawn: 10, expected: 175,
    unclassifiedCash: 35, unclassifiedCashByCurrency: { MXN: 35, USD: 7 } },
  otherCurrencies: [{ currency: "USD", cash: 2, card: 3 }], trail: [],
  withdrawals: [{ id: "33333333-3333-4333-8333-333333333333", kind: "withdrawal", currency: "MXN", amount: 10,
    note: "Returned cash", actor_email: "manager", created_at: "2026-11-11T09:00:00Z" }],
});
const t = (key: string) => translate(messagesFor(state.locale), key);
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.locale = "en"; state.refresh.mockClear(); state.toast.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function click(text: string) {
  await act(async () => { [...host.querySelectorAll("button")].find(button => button.textContent === text)!.click(); });
}
it.each(["es", "en"] as const)("discloses unclassified cash apart from sales in the open shift (%s)", async locale => {
  state.locale = locale;
  await act(async () => root.render(<ShiftBlock shifts={[view()]} currency="USD" timeZone="UTC" restaurantName="Cafe" />));
  const rows = [...host.querySelectorAll('[role="row"]')].map(row => row.textContent);
  expect(rows).toEqual([`${t("corte.opening")}MX$100.00`, `+ ${t("corte.cashSales")}MX$50.00`,
    `${t("corte.cashTips")}MX$5.00`, `+ ${t("corte.unclassifiedCash")}MX$35.00`,
    `− ${t("corte.withdrawals")}MX$10.00`, `${t("corte.expected")}MX$175.00`]);
  expect(host.textContent).toContain("$9.00"); expect(host.textContent).toContain("$3.00");
});
it.each(["es", "en"] as const)("prints every existing line and resolved cash in the closed sheet (%s)", async locale => {
  state.locale = locale;
  const write = vi.fn();
  vi.spyOn(window, "open").mockReturnValue({ document: { write, close: vi.fn() }, focus: vi.fn(), print: vi.fn() } as unknown as Window);
  await act(async () => root.render(<ShiftRecord view={view(true)} timeZone="UTC" restaurantName="Cafe" />));
  await click(t("shift.print"));
  const html = write.mock.calls[0][0];
  for (const key of ["corte.opening", "corte.cashSales", "corte.cashTips", "corte.withdrawals", "corte.expected", "shift.countedLabel", "shift.signGave", "shift.signGot"])
    expect(html).toContain(t(key));
  expect(html).toContain(`+ ${t("corte.unclassifiedCash")}`);
  expect(html).toContain("MX$35.00"); expect(html).toContain("$9.00"); expect(html).toContain("$3.00");
  expect(html).toContain("MX$175.00");
});
it("omits the unclassified line for zero cash", async () => {
  const empty = view(); empty.sum.unclassifiedCash = 0; empty.sum.unclassifiedCashByCurrency = {};
  await act(async () => root.render(<ShiftBlock shifts={[empty]} currency="MXN" timeZone="UTC" restaurantName="Cafe" />));
  expect(host.textContent).not.toContain(t("corte.unclassifiedCash"));
});
it.each(["es", "en"] as const)("keeps the linked withdrawal visible and shows its API refusal on the row (%s)", async locale => {
  state.locale = locale;
  const message = t("apiErr.cashWithdrawalLinked");
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: message }, { status: 409 })); vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<ShiftBlock shifts={[view()]} currency="MXN" timeZone="UTC" restaurantName="Cafe" />));
  await click(t("corte.removeWithdrawal"));
  expect(host.querySelector("li")?.querySelector('[role="alert"]')?.textContent).toBe(message);
  expect(host.querySelector("li")?.textContent).toContain("Returned cash");
  expect(state.refresh).not.toHaveBeenCalled();
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: "DELETE", body: JSON.stringify({ id: view().withdrawals[0].id }) });
});
