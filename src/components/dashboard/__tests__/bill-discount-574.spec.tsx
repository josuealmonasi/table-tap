// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import type { OpenBill } from "@/lib/open-bills";
const state = vi.hoisted(() => ({ locale: "en" as "en" | "es" }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor(state.locale), key, vars) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }));
vi.mock("@/hooks/useCouponOptions", () => ({ useCouponOptions: () => ({ options: [], loading: false, failed: false }) }));
import BillDiscountDialog from "../BillDiscountDialog";
let host: HTMLDivElement, root: Root;
const bill: OpenBill = { key: "t", tableId: "t", tableLabel: "1", code: null, customerName: null,
  orderIds: ["o"], items: [], total: 100, collected: 80, discount: 0, discounted: false, since: "2026-10-28", currency: "MXN" };
function text(key: string) { return translate(messagesFor(state.locale), key); }
async function render(canApprove: boolean, value = bill) {
  await act(async () => root.render(<BillDiscountDialog open bill={value} currency="MXN" canApprove={canApprove} onClose={vi.fn()} onApplied={vi.fn()} />));
}
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it.each(["en", "es"] as const)("shows only the remaining loss and explains the money already collected (%s)", async locale => {
  state.locale = locale; await render(true);
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === text("writeOff.title"))!.click());
  expect(host.querySelector(".tt-writeoff-amount strong")?.textContent).toMatch(/20/);
  expect(host.textContent).toContain(locale === "en" ? "already collected stays paid" : "ya cobrados se conservan");
  expect(host.textContent).toMatch(/80/);
});
it.each([true, false])("explains a live split and offers no discount or request (manager=%s)", async canApprove => {
  state.locale = "en"; await render(canApprove, { ...bill, collected: 0, split: { shares: 2, paidShares: 0 } });
  expect(host.querySelector("form")).toBeNull();
  expect(host.textContent).toContain("This bill is being divided");
  expect([...host.querySelectorAll("button")].some(b => b.textContent === text(canApprove ? "writeOff.title" : "writeOff.request"))).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  ["en", [1.005, 1.005], 0, "2.02"],
  ["es", [1.005, 1.005], 0, "2.02"],
  ["en", [1.005], 0.50, "0.51"],
  ["es", [1.005], 0.50, "0.51"],
  ["en", [1.005, 1.005], 0.50, "1.52"],
] as const)("quotes per-order decimal cents in %s for %j less %s", async (locale, totals, collected, expected) => {
  state.locale = locale;
  const { openBills } = await import("@/lib/open-bills");
  const orders = totals.map((total, index) => ({ id: String(index), total, table_id: "t", diner: "phone", status: "received", currency: "MXN", created_at: "2026-10-28", items: [] } as unknown as import("@/lib/types").Order));
  const grouped = openBills(orders, new Map([["0", collected]]))[0];
  await render(true, { ...grouped, collected });
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === text("writeOff.title"))!.click());
  expect(host.querySelector(".tt-writeoff-amount strong")?.textContent).toContain(expected);
});
