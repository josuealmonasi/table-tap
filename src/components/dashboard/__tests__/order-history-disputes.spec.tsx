// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import { dispute } from "@/lib/disputes/__tests__/report-fixtures";
import type { Order } from "@/lib/types";

// Review screens4: every history row read and announced chargebacks on its own:
// ten "Cargando contracargos…" lines on every page, ten identical alerts when
// the read failed, and a read even on a till that never took a card.
const state = vi.hoisted(() => ({ orders: [] as Order[], loading: false }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor("es"), key, vars),
  useLocale: () => ({ locale: "es" }) }));
vi.mock("@/hooks/useOrderHistory", () => ({ useOrderHistory: () => ({ orders: state.orders, loading: state.loading, retry: vi.fn(),
  page: 1, pages: 1, total: state.orders.length, query: "", setQuery: vi.fn() }) }));
vi.mock("../OrderReturn", () => ({ default: () => null }));
vi.mock("../OrderDetailDialog", () => ({ default: () => null }));
import OrderHistory from "../OrderHistory";

const es = (key: string) => translate(messagesFor("es"), key);
const order = (n: number, pay_method: string | null): Order => ({ id: `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`,
  paid: true, status: "completed", total: 80, tip: 0, service_fee: 0, restaurant_id: "r1", table_id: null, table_label: null,
  subtotal: 80, tax_pct: 0, note: null, pay_method, stripe_payment_intent: null, stripe_refund_id: null, items: [],
  created_at: "2026-10-28T12:00:00Z", currency: "MXN" } as Order);
let host: HTMLDivElement, root: Root;
const disputeReads = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith("/api/disputes/history"));
async function render() {
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <OrderHistory restaurantId="r1" currency="MXN" canReturn /></SWRConfig>));
}
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  state.loading = false;
  state.orders = Array.from({ length: 10 }, (_, n) => order(n, n % 2 ? "card" : null));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ [state.orders[1].id]: [{ ...dispute, movements: [] }] })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("reads the page's chargebacks once and shows them only on the order they belong to", async () => {
  await render();
  expect(disputeReads()).toHaveLength(1);
  expect(new URL(String(disputeReads()[0][0]), "http://x").searchParams.getAll("order")).toHaveLength(10);
  expect(host.textContent).not.toContain(es("disputes.loading"));
  const entries = [...host.querySelectorAll(".tt-hist-entry")];
  expect(entries[1].textContent).toContain("Contracargo");
  expect(entries.filter(e => e.textContent!.includes("Contracargo"))).toHaveLength(1);
});

it("says once when the read fails, not once per row", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ error: "x" }, { status: 500 }));
  await render();
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(host.querySelector('[role="alert"]')!.textContent).toBe(es("disputes.unavailable"));
});

it("asks nothing when no order on the page took a card, and nothing while the page loads", async () => {
  state.orders = Array.from({ length: 10 }, (_, n) => order(n, "cash"));
  await render();
  expect(disputeReads()).toHaveLength(0);
  state.orders = [order(1, "card")]; state.loading = true;
  await render();
  expect(disputeReads()).toHaveLength(0);
  expect(host.textContent).not.toContain(es("disputes.loading"));
});
