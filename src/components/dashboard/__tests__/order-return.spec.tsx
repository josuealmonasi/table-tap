// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Order } from "@/lib/types";
const state = vi.hoisted(() => ({ refresh: vi.fn(), retry: vi.fn(), orders: [] as Order[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: "en" }) }));
vi.mock("@/hooks/useOrderHistory", () => ({ useOrderHistory: () => ({ orders: state.orders, loading: false, retry: state.retry,
  page: 1, pages: 1, total: state.orders.length, query: "", setQuery: vi.fn() }) }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("./../OrderDetailDialog", () => ({ default: () => null }));
import OrderHistory from "../OrderHistory";
let host: HTMLDivElement, root: Root;
let requests: Record<string, unknown>[];
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); requests = [];
  state.orders = [{ id: "11111111-1111-4111-8111-111111111111", paid: true, status: "completed", total: 80, tip: 10,
    service_fee: 0, restaurant_id: "r1", table_id: null, table_label: null, subtotal: 70, tax_pct: 0, note: null,
    pay_method: "cash", stripe_payment_intent: null, stripe_refund_id: null, items: [], created_at: "2026-10-28T12:00:00Z", currency: "MXN" }];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    if (init?.method === "POST") { requests.push(JSON.parse(init.body as string)); throw new Error("lost reply"); }
    return Response.json({ refunds: [] });
  }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(canReturn = true) { await act(async () => root.render(<OrderHistory restaurantId="r1" currency="MXN" canReturn={canReturn} />)); }
async function click(text: string) { await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === text)!.click()); }
async function input(label: string, value: string) {
  const field = host.querySelector(`[aria-label="${label}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true })); });
}
it("shows Devolver only to managers on completed paid retained orders", async () => {
  await render(false); expect(host.querySelector("[data-order-return]")).toBeNull();
  await render(); expect(host.querySelector("[data-order-return]")).not.toBeNull();
  state.orders[0].total = 0; await render(); expect(host.querySelector("[data-order-return]")).toBeNull();
});
it("requires a reason and resends a lost reply with its exact amount, snapshot and reference", async () => {
  await render(); await click("returns.action");
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await input("returns.amount", "50"); await input("returns.reason", "Cold food");
  const send = async () => act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await send(); await send();
  expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).toMatchObject({ action: "prepare", amountCents: 5000, reason: "Cold food",
    expected: { totalCents: 8000, tipCents: 1000, serviceCents: 0 }, ref: expect.any(String) });
  expect(host.querySelector<HTMLInputElement>('[aria-label="returns.amount"]')!.disabled).toBe(true);
});
