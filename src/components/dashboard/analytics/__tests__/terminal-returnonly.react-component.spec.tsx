// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { depositDays, type DepositRecord, type TerminalPayment } from "@/lib/terminal";
import { mark, nextDay, returned, returnDay, sale } from "@/lib/__tests__/terminal-returnonly-fixtures";
import { formatMoney } from "@/lib/format";
import { messagesFor, translate, type Locale } from "@/lib/i18n";
import TerminalDeposits from "../TerminalDeposits";

const state = vi.hoisted(() => ({ send: vi.fn(), locale: "es" as Locale }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) =>
  translate(messagesFor(state.locale), key, vars) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/hooks/useCostsSend", () => ({ useCostsSend: () => state.send }));
vi.mock("@/hooks/useWhen", () => ({ useDayLabel: () => (d: string) => d, useTimeLabel: () => (d: string) => d }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? children : null }));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.locale = "es"; state.send.mockReset().mockResolvedValue(null);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(payments: TerminalPayment[] = [sale(), returned], deposits: DepositRecord[] = [mark()]) {
  const days = depositDays(payments, deposits, 3.5, 1, "America/Mexico_City", nextDay);
  await act(async () => root.render(<TerminalDeposits terminal={{ days, payments: {}, feePct: 3.5, settleDays: 1 }} currency="MXN" timeZone="America/Mexico_City" />));
  return days;
}
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent?.includes(label));
  expect(button, label).toBeDefined(); await act(async () => button!.click());
}

it.each(["es", "en"] as const)("F6 %s: own-day MX$40 debit opens and submits the bank form as -40.00", async locale => {
  state.locale = locale;
  const days = await render();
  expect(days[0]).toMatchObject({ day: returnDay, count: 0, takings: 0, fee: 0, givenBack: 40, expected: -40, status: "due" });
  expect(host.textContent).toContain(translate(messagesFor(locale), "terminal.returnOnly", { amount: formatMoney(40, "MXN") }));
  await click(returnDay);
  await click(translate(messagesFor(locale), "terminal.mark"));
  expect([...host.querySelectorAll("input")].some(i => i.value === "-40.00")).toBe(true);
  const forms = host.querySelectorAll("form");
  await act(async () => forms[1].dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(state.send).toHaveBeenCalledExactlyOnceWith("/api/terminal/deposits", "POST", {
    day: returnDay, currency: "MXN", received: "-40.00", note: undefined,
  });
});

it("F6 a sale tomorrow before marking moves the return to that sales day", async () => {
  const days = await render([sale(), returned, sale("next", nextDay, 200)]);
  expect(days.some(d => d.day === returnDay)).toBe(false);
  expect(days[0]).toMatchObject({ day: nextDay, count: 1, givenBack: 40, expected: 153 });
  expect(host.textContent).not.toContain("Solo devoluciones");
  await click(nextDay); await click("Registrar movimiento bancario");
  expect([...host.querySelectorAll("input")].some(i => i.value === "153.00")).toBe(true);
});

it("F6 marking a return-only day consumes it even when a later MXN sales day appears", async () => {
  const signed = mark(returnDay, -40, [], ["return:x"]);
  const days = await render([sale(), returned, sale("next", nextDay, 200)], [mark(), signed]);
  expect(days.find(d => d.day === returnDay)).toMatchObject({ count: 0, givenBack: 40, expected: -40, status: "received", late: 0 });
  expect(days[0]).toMatchObject({ day: nextDay, givenBack: 0, expected: 193 });
  await click(returnDay);
  expect(host.textContent).toContain("Quitar marca");
  expect(host.textContent).not.toContain("Registrar movimiento bancario");
});

it("F6 return-only days become overdue instead of waiting forever", async () => {
  expect(depositDays([sale(), returned], [mark()], 3.5, 1, "UTC", "2026-12-01")[0])
    .toMatchObject({ day: returnDay, status: "overdue", expected: -40 });
});
