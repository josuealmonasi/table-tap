// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { messagesFor, translate, type Locale } from "@/lib/i18n";
const state = vi.hoisted(() => ({ fetch: vi.fn(), method: "cash", resolved: false, shiftCurrency: "MXN", shiftId: "open", withdrawals: true, locale: "keys" as "keys" | Locale, links: {} as Record<string, string | null> }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => state.locale === "keys" ? key : translate(messagesFor(state.locale), key, vars), useLocale: () => ({ locale: state.locale === "keys" ? "en" : state.locale }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/hooks/useOfflineSales", () => ({ useOfflineSales: () => ({ held: [], flush: vi.fn() }) }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div> }));
import HeldSales from "@/components/dashboard/pos/HeldSales";
const restaurantId = "11111111-1111-4111-8111-111111111111", posRef = "22222222-2222-4222-8222-222222222222", link = "33333333-3333-4333-8333-333333333333";
const collectedAt = "2026-11-10T12:00:00.000Z";
const row = () => ({ pos_ref: posRef, collector: "cashier@test.dev", currency: "MXN", approved_at: null, resolved_at: state.resolved ? collectedAt : null,
  resolution: state.resolved ? { disposition: "no_cash", resolved_by: "manager@test.dev", resolved_at: collectedAt, reason: "No money taken", amount: 0, currency: "MXN", ...state.links } : null,
  body: { method: state.method, items: [], offline: { at: collectedAt, total: 12.5 } } });
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("fetch", state.fetch);
  state.locale = "keys"; state.links = {}; state.method = "cash"; state.resolved = false; state.shiftCurrency = "MXN"; state.shiftId = "open"; state.withdrawals = true; state.fetch.mockReset();
  state.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      state.resolved = true;
      return Response.json({ restaurant_id: restaurantId, pos_ref: posRef, disposition: JSON.parse(String(init.body)).disposition });
    }
    if (url.endsWith("/resolve")) return Response.json({ restaurantId, shiftId: state.shiftId, shiftCurrency: state.shiftCurrency, withdrawals: state.withdrawals ? [{ id: link, amount: 12.5, currency: "MXN", note: "Returned cash" }, { id: "wrong", amount: 1, currency: "MXN" }] : [] });
    return Response.json({ restaurantId, sales: url.includes("history") || !state.resolved ? [row()] : [] });
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount() { const cache = new Map(); await act(async () => root.render(<SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}><HeldSales restaurantId={restaurantId} currency="MXN" /></SWRConfig>)); }
async function click(text: string) { await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === text)!.click(); }); }
async function radio(value: string) { await act(async () => host.querySelector<HTMLInputElement>(`[value="${value}"]`)!.click()); }
async function input(selector: string, value: string) {
  const el = [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)].at(-1)!;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}
it("no_cash locks the amount to zero", async () => {
  await mount(); await click("heldResolve.action"); await radio("no_cash");
  const amount = host.querySelector<HTMLInputElement>('input[type="number"]')!;
  expect({ value: amount.value, disabled: amount.disabled }).toEqual({ value: "0", disabled: true });
});
it("card receipts have no resolve action", async () => {
  state.method = "card"; await mount();
  expect([...host.querySelectorAll("button")].some(b => b.textContent === "heldResolve.action")).toBe(false);
});
it.each(["no_cash", "retained_cash", "returned_cash", "duplicate"])("submits the %s body", async disposition => {
  await mount(); await click("heldResolve.action"); await radio(disposition); await input("textarea", "No money taken");
  if (disposition === "returned_cash") await input('[role="dialog"] select:last-of-type', link);
  if (disposition === "duplicate") await input('[role="dialog"] input:not([type])', link);
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const sent = state.fetch.mock.calls.find(([, init]) => init?.method === "POST");
  expect(sent && { url: sent[0], body: JSON.parse(sent[1].body) }).toEqual({ url: "/api/pos/recover/resolve", body: {
    restaurantId, posRef, disposition, reason: "No money taken", collector: "cashier@test.dev", amount: disposition === "no_cash" ? 0 : 12.5,
    currency: "MXN", collectedAt, ...(disposition === "returned_cash" ? { payoutId: link } : {}), ...(disposition === "duplicate" ? { paymentId: link } : {}),
  } });
});
it("moves a resolved receipt from pending to history with its disposition and audit", async () => {
  await mount(); await click("heldResolve.action"); await radio("no_cash"); await input("textarea", "No money taken");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const pendingText = host.textContent;
  await click("heldSalesView.history");
  expect({ pending: pendingText?.includes("ORD-2222"), history: host.textContent?.includes("ORD-2222"),
    disposition: host.textContent?.includes("heldResolve.no_cash"), reason: host.textContent?.includes("No money taken"),
    approved: host.textContent?.includes("recovery.approved"), action: host.textContent?.includes("heldResolve.action") }).toEqual({
    pending: false, history: true, disposition: true, reason: true, approved: false, action: false,
  });
});

it("foreign returned cash submits without a payout or payout instructions", async () => {
  state.shiftCurrency = "USD"; state.withdrawals = false;
  await mount(); await click("heldResolve.action"); await radio("returned_cash"); await input("textarea", "Cash already returned");
  expect(host.textContent).not.toContain("heldResolve.choosePayout");
  expect(host.textContent).not.toContain("heldResolve.recordPayout");
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const sent = state.fetch.mock.calls.find(([, init]) => init?.method === "POST");
  expect(sent).toBeDefined();
  expect(JSON.parse(sent![1].body)).toMatchObject({ disposition: "returned_cash", currency: "MXN", amount: 12.5 });
  expect(JSON.parse(sent![1].body)).not.toHaveProperty("payoutId");
});
it("drawer-currency returns with no matching payout explain what to record and cannot submit", async () => {
  state.withdrawals = false;
  await mount(); await click("heldResolve.action"); await radio("returned_cash"); await input("textarea", "Cash already returned");
  expect(host.textContent).toContain("heldResolve.recordPayout");
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
});
it("foreign returned cash still requires an open shift", async () => {
  state.shiftCurrency = "USD"; state.shiftId = "";
  await mount(); await click("heldResolve.action"); await radio("returned_cash"); await input("textarea", "Cash already returned");
  expect(host.textContent).toContain("apiErr.heldResolveOpenShift");
  expect(host.textContent).not.toContain("heldResolve.recordPayout");
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
});

it.each(["es", "en"] as const)("history exposes each accounting link and copies its full id (%s)", async locale => {
  state.locale = locale; state.resolved = true;
  const receipt = "44444444-4444-4444-8444-444444444444", payout = "55555555-5555-4555-8555-555555555555";
  state.links = { cash_receipt_id: receipt, payment_id: link, payout_id: payout };
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await mount(); await click(translate(messagesFor(locale), "heldSalesView.history"));
  for (const [key, id] of Object.entries(state.links)) {
    const label = translate(messagesFor(locale), `heldResolve.${key}`, { id: `${id!.slice(0, 8)}…` });
    const button = [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === label)!;
    expect(button, label).toBeDefined(); expect(button.title).toBe(id);
    await act(async () => button.click());
    expect(writeText).toHaveBeenLastCalledWith(id);
  }
  expect(host.textContent).not.toContain("undefined"); expect(host.textContent).not.toContain("null");
});
