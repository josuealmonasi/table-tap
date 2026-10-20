import React from "react";
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { messagesFor, translate } from "@/lib/i18n";
import { reviewSale, type QueuedOfflineSale } from "@/lib/offline-review";
vi.stubGlobal("React", React);
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor("en"), key, vars) }));
const { default: RecoveryForm } = await import("@/components/dashboard/pos/RecoveryForm");

it("shows the proven collector, original currency, method and review reason without dropping timestamp precision", () => {
  const row: QueuedOfflineSale = {
    pos_ref: "6b1f0c2e-0000-4000-8000-000000000001", collector: "original@example.com", currency: "USD", submitted_by: "manager@example.com",
    reason: "recovery.currencyChanged", approved_at: null, approved_by: null,
    body: { method: "card", items: [], offline: { at: "2026-10-20T12:34:56.789Z", subtotal: 80, serviceFee: 0, tip: 0, discount: 0, total: 80 } },
  };
  const html = renderToStaticMarkup(<RecoveryForm sale={reviewSale(row, "r")} currentCurrency="MXN" busy={false} onClose={() => {}} onSubmit={() => {}} />);
  expect(html).toContain("$80.00 · USD");
  expect(html).not.toContain("MX$80.00");
  expect(html).toContain("Restaurant terminal");
  expect(html).toContain("This sale was collected in another currency");
  expect(html).toMatch(/type="email"[^>]*disabled=""[^>]*value="original@example.com"/);
  expect(html).toContain(":56.789");
  expect(html).not.toContain("Restore USD in Settings");
});
it("keeps the collected currency in the activity log instead of relabelling its amount", async () => {
  const { useLogWords } = await import("@/hooks/useLogWords");
  const words = useLogWords("MXN");
  expect(words.specifics({ entity: "bill", action: "paid", detail: "amount=80.00 currency=USD method=cash" })).toContain("$80.00 USD");
  expect(words.specifics({ entity: "bill", action: "paid", detail: "amount=80.00 currency=USD method=cash" })).not.toContain("MX$80.00");
  expect(words.describe({ entity: "terminal", action: "approved", detail: null })).toBe("verified a terminal deposit’s currency");
  expect(words.describe({ entity: "order", action: "offline_recovered", detail: null })).toBe("approved a saved sale");
});

it("shows saved line prices and breakdown beside the server comparison before approval", () => {
  const sale = { posRef: "sale", restaurantId: "r", at: "2026-10-20T12:00:00Z", method: "cash" as const, currency: "MXN",
    items: [{ itemId: "dish", name: "Dish", emoji: "", qty: 1, price: 70, mods: {} }],
    charge: { subtotal: 70, serviceFee: 5, tip: 5, discount: 0, total: 80 } };
  const html = renderToStaticMarkup(<RecoveryForm sale={sale} currentCurrency="MXN" busy={false} onClose={() => {}} onSubmit={() => {}}
    comparison={{ currency: "MXN", lines: [{ ...sale.items[0], price: 90 }], charge: { subtotal: 90, serviceFee: 5, tip: 5, discount: 0, total: 100 }, difference: -20 }} />);
  for (const text of ["70.00", "Subtotal", "Service", "Tip", "Today&#x27;s menu", "100.00", "20.00"]) expect(html).toContain(text);
});
it("explicitly says when today's menu cannot be compared", () => {
  const sale = { posRef: "sale", restaurantId: "r", at: "2026-10-20T12:00:00Z", method: "cash" as const,
    items: [], charge: { subtotal: 80, serviceFee: 0, tip: 0, discount: 0, total: 80 } };
  const html = renderToStaticMarkup(<RecoveryForm sale={sale} currentCurrency="MXN" busy={false} onClose={() => {}} onSubmit={() => {}} comparison={null} />);
  expect(html).toContain("Can&#x27;t compare");
});
