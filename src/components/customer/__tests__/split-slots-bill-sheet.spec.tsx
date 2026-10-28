import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { tableBill } from "@/lib/table-bill";
import type { Order, Restaurant } from "@/lib/types";
const state = vi.hoisted(() => ({ ready: false, split: null as object | null }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/useSplit", () => ({ useSplit: () => ({ ...state, diner: "member" }) }));
vi.mock("@/hooks/useBillPayment", () => ({ useBillPayment: () => ({ busy: false, called: false }) }));
import BillSheet from "../BillSheet";
const order = { id: "order", currency: "MXN", total: 100, paid: false, status: "received", items: [] } as unknown as Order;
function render(splitEnabled = true, mixed = false) {
  return renderToStaticMarkup(<BillSheet open onClose={vi.fn()} bill={tableBill(mixed ? [order, { ...order, id: "usd", currency: "USD" }] : [order], [])}
    restaurant={{ id: "restaurant", currency: "MXN", cards_enabled: true, split_enabled: splitEnabled } as Restaurant}
    tableId="table" sessionId="session" tableLabel="1" photoOf={() => null} />);
}
beforeEach(() => { vi.stubGlobal("React", React); state.ready = false; state.split = null; });
it("keeps the waiter while checking parts and offers no whole-bill card button", () => {
  const html = render(); expect(html).toContain("bill.payAtTable"); expect(html).not.toContain("bill.payNow");
});
it.each([true, false])("keeps an existing split payable when the switch is %s", enabled => {
  state.ready = true;
  state.split = { id: "split", status: "locked", modelVersion: 2, revision: 1, currency: "MXN", shares: 2, outstanding: 100, slots: [] };
  const html = render(enabled); expect(html).toContain('data-split-model="2"'); expect(html).not.toContain("bill.payNow");
});
it("keeps the saved-currency parts visible beside another currency's debt", () => {
  state.ready = true;
  state.split = { id: "split", status: "locked", modelVersion: 2, revision: 1, currency: "MXN", shares: 2, outstanding: 0, slots: [] };
  expect(render(true, true)).toContain('data-split-model="2"');
});
it("does not offer legacy share checkout on a bill the waiter is collecting", () => {
  state.ready = true;
  state.split = { id: "old", status: "locked", mine: { amount: 50, paid: false }, ownSince: 0, shares: 2 };
  const html = renderToStaticMarkup(<BillSheet open onClose={vi.fn()} bill={tableBill([order], [])}
    restaurant={{ id: "restaurant", currency: "MXN", cards_enabled: true } as Restaurant}
    tableId="table" sessionId="session" tableLabel="1" staffBill photoOf={() => null} />);
  expect(html).not.toContain("split.payShare"); expect(html).toContain("bill.payAtTable");
});
