import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate, type Locale } from "@/lib/i18n";
import type { KitchenTicket } from "@/lib/kitchen-ticket";
import { STATUS_META } from "@/lib/order-status";
const state = vi.hoisted(() => ({ locale: "es" as Locale }));
vi.mock("@/lib/i18n/context", () => ({ useLocale: () => ({ locale: state.locale }),
  useT: () => (key: string) => translate(messagesFor(state.locale), key),
}));
vi.mock("../OrderDetailDialog", () => ({ default: () => null }));
vi.mock("../TicketWait", () => ({ default: () => null }));
import OrderCard from "../OrderCard";
beforeEach(() => vi.stubGlobal("React", React));
it.each(["es", "en"] as const)("floor tickets show their real stage in %s", locale => {
  state.locale = locale;
  for (const status of ["received", "preparing", "pending_payment", "completed"] as const) {
    const order: KitchenTicket = { id: "ticket", code: "1234", restaurant_id: "r", status,
      items: [], note: null, table_label: "1", created_at: "2026-10-29T12:00:00Z" };
    const html = renderToStaticMarkup(<OrderCard order={order} currency="MXN" canMove={false} onAdvance={vi.fn()} />);
    const footer = html.slice(html.indexOf('class="tt-order-foot"'));
    expect(footer).toContain(translate(messagesFor(locale), STATUS_META[status].labelKey));
    expect(footer).not.toContain(translate(messagesFor(locale), "orders.done"));
    expect(footer).not.toContain("<button");
  }
});
it("still offers delivery for ready floor tickets and preparation for the kitchen", () => {
  state.locale = "en";
  const order: KitchenTicket = { id: "ticket", code: "1234", restaurant_id: "r", status: "ready",
    items: [], note: null, table_label: "1", created_at: "2026-10-29T12:00:00Z" };
  expect(renderToStaticMarkup(<OrderCard order={order} currency="MXN" canMove={false} onAdvance={vi.fn()} />))
    .toContain(translate(messagesFor("en"), "orders.complete"));
  expect(renderToStaticMarkup(<OrderCard order={{ ...order, status: "received" }} currency="MXN" onAdvance={vi.fn()} />))
    .toContain(translate(messagesFor("en"), "orders.startPreparing"));
});
