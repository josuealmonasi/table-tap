// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ fetch: vi.fn(), held: [] }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, unknown>) => key + (vars?.count === undefined ? "" : ` ${vars.count}`), useLocale: () => ({ locale: "en" }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/hooks/useOfflineSales", () => ({ useOfflineSales: () => ({ held: state.held, flush: vi.fn() }) }));
vi.mock("@/components/dashboard/pos/RecoveryReview", () => ({ default: ({ onSubmit }: { onSubmit: (details: object) => void }) => <button onClick={() => onSubmit({ currency: "USD", reason: "Original receipt reviewed" })}>approve</button> }));
import { SWRConfig, type Cache } from "swr";
import HeldSales from "@/components/dashboard/pos/HeldSales";
const row = (id: string, approved = false) => ({ pos_ref: id, currency: "USD", collector: "original@example.com", reason: "recovery.currencyChanged", approved_at: approved ? "2026-10-27T12:00:00Z" : null,
  approved_by: approved ? "manager@example.com" : null, body: { method: "cash", items: [], offline: { at: "2026-10-26T12:00:00Z", subtotal: 80, serviceFee: 0, discount: 0, tip: 0, total: 80 } } });
let host: HTMLDivElement, root: Root, cache: Cache;
const pending = row("1111-pending"), approved = row("2222-approved", true);
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("fetch", state.fetch); vi.useFakeTimers(); state.fetch.mockReset();
  state.fetch.mockImplementation(async (url: string, init?: RequestInit) => init?.method === "POST" ? Response.json({ settled: true, orderId: pending.pos_ref, total: 80, currency: "USD", method: "cash" })
    : Response.json(url.includes("view=history") ? { sales: [approved], hasMore: url.includes("page=0") } : { sales: [pending] }));
  cache = new Map() as Cache; host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => root.render(<SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}><HeldSales restaurantId="r" currency="MXN" /></SWRConfig>)); }
async function click(text: string) { await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent?.includes(text))!.click(); }); }
it("opens pending only, keeps its count, and paginates history without polling it", async () => {
  await mount(); expect(host.textContent).toContain("ORD-1111"); expect(host.textContent).not.toContain("ORD-2222");
  expect(host.textContent).toContain("heldSalesView.pending 1");
  await click("heldSalesView.history"); expect(host.textContent).toContain("ORD-2222"); expect(host.textContent).not.toContain("ORD-1111");
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(state.fetch.mock.calls.filter(([url]) => url.includes("view=history"))).toHaveLength(1);
  expect(state.fetch.mock.calls.filter(([url]) => !url.includes("view=history"))).toHaveLength(3);
  await click("heldSalesView.next"); expect(state.fetch.mock.calls.at(-1)![0]).toContain("page=1");
  expect([...host.querySelectorAll("button")].find(b => b.textContent === "heldSalesView.next")!.disabled).toBe(true);
});
it("retains the manager approval request and refreshes pending after approval", async () => {
  await mount(); await click("recovery.review"); await click("approve");
  const sent = state.fetch.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(sent[1].body)).toEqual({ posRef: pending.pos_ref, restaurantId: "r", approval: { confirmed: true, currency: "USD", reason: "Original receipt reviewed" } });
  expect(state.fetch.mock.calls.at(-1)![0]).toBe("/api/pos/recover");
});
it("does not replace a history page with a late response from the previous page", async () => {
  await mount(); let answer!: (response: Response) => void;
  state.fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { answer = resolve; }));
  await click("heldSalesView.history"); await click("heldSalesView.pending");
  await act(async () => { answer(Response.json({ sales: [approved], hasMore: true })); });
  expect(host.textContent).toContain("ORD-1111"); expect(host.textContent).not.toContain("ORD-2222");
});
