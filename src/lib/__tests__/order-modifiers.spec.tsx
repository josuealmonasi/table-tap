import { afterAll, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { kitchenTicket, modsOf } from "@/lib/ticket";
import type { Order, OrderLineItem } from "@/lib/types";

vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: "en" }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => () => {} }));
// Vitest preserves the app's JSX; Next supplies this runtime in the browser.
vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());
const { default: OrderCard } = await import("@/components/dashboard/OrderCard");
const { default: OrderDetailDialog } = await import("@/components/dashboard/OrderDetailDialog");

const mods = { Size: "Large", bad: { toString: "x" }, Sauces: ["Hot", { toString: "x" }, 3, null] };
const item = { itemId: "burger", name: "Burger", emoji: "", price: 100, qty: 1, mods } as unknown as OrderLineItem;
const order = {
  id: "12345678", items: [item], status: "received", paid: false, total: 100,
  created_at: "2026-10-20T12:00:00Z", table_label: "7", currency: "MXN",
} as Order;

describe("G1: old rows cannot stop the board or printer", () => {
  it("renders only string modifier values, including inside arrays", () => {
    expect(modsOf(item)).toBe("Large · Hot");
  });
  it.each([null, [], "bad", 1])("ignores an invalid modifier container: %j", value => {
    expect(modsOf({ mods: value } as never)).toBe("");
  });
  it("prints an old malformed line and component without poisoning the queue", () => {
    const combo = { ...item, comboId: "meal", components: [{ itemId: "burger", name: "Burger", qty: 1, mods }] };
    const ticket = kitchenTicket({ ...order, items: [combo as unknown as OrderLineItem] },
      { name: "Cafe", timeZone: "UTC" }, key => key);
    expect(ticket).toContain("Large · Hot");
    expect(ticket).not.toContain("[object Object]");
  });
  it("renders the actual kitchen card with an old malformed row", () => {
    expect(renderToStaticMarkup(createElement(OrderCard, { order, currency: "MXN", onAdvance: () => {} })))
      .toContain("Large · Hot");
  });
  it("opens the detail without rendering malformed choices", () => {
    expect(renderToStaticMarkup(createElement(OrderDetailDialog, { order, currency: "MXN", open: true, onClose: () => {} })))
      .not.toContain("[object Object]");
  });
});
