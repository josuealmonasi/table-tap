// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SaleBreakdown from "@/components/dashboard/pos/SaleBreakdown";
import HeldSales from "@/components/dashboard/pos/HeldSales";
import { reviewSale, type QueuedOfflineSale } from "@/lib/offline-review";
import type { OrderLineItem } from "@/lib/types";
import type { OfflineCharge } from "@/lib/offline-sale";

const state = vi.hoisted(() => ({ rows: [] as QueuedOfflineSale[] }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: "en" }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/hooks/useOfflineSales", () => ({ useOfflineSales: () => ({ held: [], flush: vi.fn() }) }));
vi.mock("@/hooks/useHeldSales", () => ({ useHeldSales: () => ({ rows: state.rows, pendingCount: state.rows.length }) }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div> }));
vi.mock("@/components/dashboard/pos/RecoveryReview", async () => ({ default: (await import("@/components/dashboard/pos/RecoveryForm")).default }));

const line = { itemId: "soup", name: "Soup", price: 12.5, qty: 1, mods: {} };
const charge = { subtotal: 12.5, serviceFee: 0, tip: 0, discount: 0, total: 12.5 };
const row = (items: unknown = [line], amounts: unknown = charge) => ({
  pos_ref: "c7ab3000-0000-4000-8000-000000000011", collector: null, currency: null,
  reason: "apiErr.offlineApproval", approved_at: null, approved_by: null, submitted_by: "cashier@example.com",
  body: { method: "cash", items, offline: { at: "2099-01-01T00:00:00Z", ...(amounts as object) } },
}) as QueuedOfflineSale;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it.each([{ extras: {} }, { extras: [null] }, { name: { poisoned: true } }])(
  "projects normalized review lines without changing the raw receipt: %j", malformed => {
    const raw = row([{ ...line, ...malformed }]);
    const before = JSON.stringify(raw);
    const sale = reviewSale(raw, "r");
    expect({ items: sale.items, raw: JSON.stringify(raw) }).toEqual({
      items: [{ ...line, emoji: "", extras: "extras" in malformed && Array.isArray(malformed.extras)
        ? [{ id: "", name: "", emoji: "", price: 0 }] : [], name: "name" in malformed ? "—" : "Soup" }], raw: before,
    });
  });

it("projects every legacy charge field into numbers without rewriting the raw receipt or its clock", () => {
  const raw = row([], { subtotal: "12,50", serviceFee: "0,50", tip: "1.00", discount: "1,250.00", total: "14,00" });
  const before = JSON.stringify(raw);
  const sale = reviewSale(raw, "r");
  expect({ charge: sale.charge, at: sale.at, raw: JSON.stringify(raw) }).toEqual({
    charge: { subtotal: 12.5, serviceFee: 0.5, tip: 1, discount: 1250, total: 14 }, at: raw.body.offline.at, raw: before,
  });
});

it.each([{ extras: {} }, { extras: [null] }, { name: { poisoned: true } }])(
  "renders a normalized breakdown even when called with legacy raw lines: %j", malformed => {
    const html = renderToStaticMarkup(<SaleBreakdown items={[{ ...line, ...malformed }] as OrderLineItem[]} charge={charge} currency="USD" />);
    expect(html).toContain("name" in malformed ? "1 × —" : "1 × Soup");
  });

it("renders normalized breakdown amounts for legacy formatted strings", () => {
  const html = renderToStaticMarkup(<SaleBreakdown items={[]} currency="USD"
    charge={{ subtotal: "12,50", serviceFee: "0,50", tip: "1,00", discount: "1,250.00", total: "14,00" } as unknown as OfflineCharge} />);
  expect([...html.matchAll(/<dd>(.*?)<\/dd>/g)].map(m => m[1])).toEqual(["$12.50", "$1,250.00", "$0.50", "$1.00", "$14.00"]);
});

it("opens a held legacy receipt with no currency, string total and malformed lines", async () => {
  state.rows = [row([{ ...line, extras: {}, name: { poisoned: true } }, { ...line, extras: [null] }], { ...charge, total: "12,50" })];
  const before = JSON.stringify(state.rows);
  await act(async () => root.render(<HeldSales restaurantId="r" currency="MXN" />));
  const summary = host.querySelector("strong")?.textContent;
  await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "recovery.review")!.click(); });
  expect({ summary, lines: host.querySelectorAll('[role="dialog"] li').length,
    total: host.querySelector('[role="dialog"] dd:last-child')?.textContent, raw: JSON.stringify(state.rows) }).toEqual({
    summary: "ORD-C7AB · 12.50 ", lines: 2, total: "MX$12.50", raw: before,
  });
});
