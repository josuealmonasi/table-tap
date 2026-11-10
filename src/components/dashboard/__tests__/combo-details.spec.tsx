import * as React from "react";
import { afterAll, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OrderCard from "../OrderCard";
import OrderDetailDialog from "../OrderDetailDialog";
import type { Order } from "@/lib/types";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: "en" }) }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? children : null }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
const order: Order = {
  restaurant_id: "r", table_id: null, table_label: null, subtotal: 100, service_fee: 0, tip: 0, tax_pct: 0,
  currency: "MXN", note: null, pay_method: null, paid: false, stripe_payment_intent: null, stripe_refund_id: null,
  id: "combo-order", created_at: "2026-11-09T12:00:00Z", status: "preparing", total: 100,
  items: [{ itemId: "lunch", name: "Lunch", emoji: "", qty: 2, price: 50, mods: {}, extras: [{ id: "cheese", emoji: "", name: "Cheese", price: 5 }],
    components: [{ itemId: "burger", name: "Burger", emoji: "", qty: 1, mods: { Cook: "Well done" }, extras: [{ id: "cheese", emoji: "", name: "Cheese", price: 5 }] },
      { itemId: "coffee", name: "Coffee", emoji: "", qty: 2, mods: { Milk: "Oat milk" } }] }],
};

it.each(["card", "detail"])("B6: %s shows every combo component with its own choices and extras once", view => {
  const html = renderToStaticMarkup(view === "card"
    ? <OrderCard order={order} currency="MXN" onAdvance={vi.fn()} />
    : <OrderDetailDialog order={order} currency="MXN" open onClose={vi.fn()} />);
  for (const text of ["Burger", "Well done", "Coffee", "Oat milk"]) expect(html).toContain(text);
  expect(html.match(/Cheese/g)).toHaveLength(1);
});

it.each(["card", "detail"])("B6: %s keeps parent-only extras from older combos", view => {
  const legacy: Order = { ...order, items: order.items.map(item => ({
    ...item, components: item.components?.map(part => ({ ...part, extras: undefined })),
  })) };
  const html = renderToStaticMarkup(view === "card"
    ? <OrderCard order={legacy} currency="MXN" onAdvance={vi.fn()} />
    : <OrderDetailDialog order={legacy} currency="MXN" open onClose={vi.fn()} />);
  expect(html.match(/Cheese/g)).toHaveLength(1);
});
