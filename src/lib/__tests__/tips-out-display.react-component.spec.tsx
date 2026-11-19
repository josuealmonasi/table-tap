import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import type { ShiftView } from "@/lib/cash-shift";
import { pendingHarness } from "./pending-ui-harness";

const state = vi.hoisted(() => ({ ui: null as unknown as ReturnType<typeof pendingHarness>, locale: "en" as "en" | "es" }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (v: unknown) => state.ui.useState(v), useRef: (v: unknown) => state.ui.useRef(v),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useLocale: () => ({ locale: state.locale }),
  useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor(state.locale), key, vars) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/components/ui/Modal", () => ({ Modal: () => null }));
import ShiftBlock from "@/components/dashboard/cash/ShiftBlock";
import ShiftRecord from "@/components/dashboard/cash/ShiftRecord";

const view: ShiftView = {
  shift: { id: "shift", currency: "MXN", opened_at: "2026-11-11T08:00:00Z", closed_at: "2026-11-11T16:00:00Z",
    opened_by: "a", closed_by: "a", opening_amount: 20, expected_cash: 115, counted_cash: 115,
    difference: 0, difference_note: null, explained_by: null },
  sum: { opening: 20, cashSales: 110, tips: 10, tips_out: 8.5, withdrawn: 15, expected: 115 },
  trail: [], withdrawals: [],
};
beforeEach(() => { vi.stubGlobal("React", React); state.ui = pendingHarness(); state.locale = "en"; });
const t = (key: string) => translate(messagesFor(state.locale), key);
function render(kind: "live" | "record", tips_out: number | undefined, tips = 10): void {
  const v = { ...view, sum: { ...view.sum, tips_out, tips } };
  state.ui.render(() => kind === "live"
    ? <ShiftBlock shifts={[{ ...v, shift: { ...v.shift, closed_at: null } }]} currency="USD" timeZone="UTC" restaurantName="Cafe" />
    : <ShiftRecord view={v} timeZone="UTC" restaurantName="Cafe" />);
}
function print(): string {
  const write = vi.fn();
  vi.stubGlobal("window", { open: () => ({ document: { write, close() {} }, focus() {}, print() {} }) });
  state.ui.all("button").find(n => n.text === t("shift.print"))!.props.onClick!();
  return write.mock.calls[0][0];
}
for (const locale of ["en", "es"] as const) {
  it.each(["live", "record"] as const)(`shows tips paid out below tips in the %s (${locale})`, kind => {
    state.locale = locale; render(kind, 8.5);
    const rows = state.ui.all("div").filter(n => n.props.role === "row").map(n => n.text);
    const at = rows.findIndex(text => text.includes(t("corte.cashTips")));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(rows[at + 1]).toBe(`${t("corte.tipsOut")}MX$8.50`);
    expect(state.ui.text()).toContain("MX$115.00");
    if (kind === "record") {
      const html = print();
      expect(html).toContain(`${t("corte.tipsOut")}</td><td style="text-align:right">MX$8.50`);
      expect(html.indexOf(t("corte.tipsOut"))).toBeGreaterThan(html.indexOf(t("corte.cashTips")));
      expect(html.indexOf(t("corte.tipsOut"))).toBeLessThan(html.indexOf(t("corte.withdrawals")));
      expect(html).toContain("MX$115.00");
    }
  });
}
it.each([0, undefined])("hides tips paid out when absent (%s) on screen and print", tips_out => {
  for (const kind of ["live", "record"] as const) {
    state.ui = pendingHarness(); render(kind, tips_out);
    expect(state.ui.text()).not.toContain(t("corte.tipsOut"));
    if (kind === "record") expect(print()).not.toContain(t("corte.tipsOut"));
  }
});
it.each(["live", "record"] as const)("shows payouts even without cash tips in the %s", kind => {
  render(kind, 8.5, 0);
  expect(state.ui.text()).not.toContain(t("corte.cashTips"));
  expect(state.ui.text()).toContain(`${t("corte.tipsOut")}MX$8.50`);
  if (kind === "record") expect(print()).toContain(t("corte.tipsOut"));
});
