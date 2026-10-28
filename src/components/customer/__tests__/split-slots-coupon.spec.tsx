// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppliedCoupon } from "@/lib/pricing";
import { tableBill } from "@/lib/table-bill";
import type { Order, Restaurant } from "@/lib/types";
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/useSplit", () => ({ useSplit: () => ({ split: null, ready: true, diner: "member" }) }));
vi.mock("@/hooks/useBillPayment", () => ({ useBillPayment: () => ({ busy: false, called: false }) }));
vi.mock("../BillExtras", () => ({ default: ({ onCoupon }: { onCoupon: (c: AppliedCoupon) => void }) =>
  <button data-apply-coupon onClick={() => onCoupon({ code: "SAVE", kind: "fixed", value: 10 })}>Apply test coupon</button> }));
import BillSheet from "../BillSheet";
let root: Root, el: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  el = document.createElement("div"); root = createRoot(el);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("keeps coupon checkout payable and asks staff to put the coupon on the bill before splitting", async () => {
  const order = { id: "order", total: 100, currency: "MXN", paid: false, status: "received", items: [] } as unknown as Order;
  await act(async () => root.render(<BillSheet open onClose={vi.fn()} bill={tableBill([order], [])}
    restaurant={{ id: "restaurant", currency: "MXN", cards_enabled: true, coupons_enabled: true } as Restaurant}
    tableId="table" sessionId="session" tableLabel="1" photoOf={() => null} />));
  expect(el.querySelector(".tt-split-ask")).not.toBeNull();
  await act(async () => el.querySelector<HTMLButtonElement>("[data-apply-coupon]")!.click());
  expect(el.querySelector(".tt-split-ask")).toBeNull();
  expect(el.textContent).toContain("slots.couponFirst");
  expect(el.textContent).toContain("bill.payNow");
});
