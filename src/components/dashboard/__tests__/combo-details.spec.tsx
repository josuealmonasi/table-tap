import * as React from "react";
import { afterAll, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import OrderCard from "../OrderCard";
import OrderDetailDialog from "../OrderDetailDialog";
import type { Order } from "@/lib/types";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: "en" }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
const order = {
  id: "combo-order", created_at: "2026-11-09T12:00:00Z", status: "preparing", total: 100,
  items: [{ name: "Lunch", emoji: "", qty: 2, price: 50, mods: {}, extras: [{ name: "Cheese", price: 5 }],
    components: [{ name: "Burger", emoji: "", qty: 1, mods: { Cook: "Well done" }, extras: [{ name: "Cheese", price: 5 }] },
      { name: "Coffee", emoji: "", qty: 2, mods: { Milk: "Oat milk" } }] }],
} as Order;

it.each(["card", "detail"])("B6: %s shows every combo component with its own choices and extras once", view => {
  const html = renderToStaticMarkup(view === "card"
    ? <OrderCard order={order} currency="MXN" onAdvance={vi.fn()} />
    : <OrderDetailDialog order={order} currency="MXN" open onClose={vi.fn()} />);
  for (const text of ["Burger", "Well done", "Coffee", "Oat milk"]) expect(html).toContain(text);
  expect(html.match(/Cheese/g)).toHaveLength(1);
});
