// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import CheckPayment from "../CheckPayment";
import type { PaymentCheckScope } from "@/lib/payment-check";
import type { Order } from "@/lib/types";
const state = vi.hoisted(() => ({ cancel: vi.fn(), confirm: vi.fn(), refresh: vi.fn(), refusal: null as PaymentCheckScope | null }));
const order: Order = {
  id: "a", restaurant_id: "r1", status: "received", items: [], created_at: "2026-10-27",
  table_id: null, table_label: null, subtotal: 100, service_fee: 0, total: 100, tip: 0,
  tax_pct: 0, paid: true, written_off: false, currency: "MXN", pay_method: "cash",
  stripe_payment_intent: null, stripe_refund_id: null, note: null,
};
vi.mock("@/hooks/useRestaurantOrders", () => ({ useRestaurantOrders: () => ({
  orders: [order], inactiveOrderIds: new Set(), hideInactive: vi.fn(), cancelOrder: state.cancel,
  cancelPlanFor: async () => ({ paid: false }), online: true, pending: 0,
  checkoutRefusal: state.refusal,
}) }));
vi.mock("@/hooks/useBoardStation", () => ({ useBoardStation: () => [null, vi.fn()] }));
vi.mock("@/hooks/useRefreshWhenPaid", () => ({ useRefreshWhenPaid: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => state.confirm }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
import OrdersBoard from "../OrdersBoard";
interface NodeProps {
  children?: React.ReactNode;
  onCancel?: (order: Order) => Promise<void>;
  onSettled?: () => void;
}
function find(node: React.ReactNode, prop: "onCancel" | "onSettled"): NodeProps {
  if (!React.isValidElement<NodeProps>(node)) return {};
  if (node.props[prop]) return node.props;
  for (const child of React.Children.toArray(node.props.children)) {
    const found = find(child, prop);
    if (found[prop]) return found;
  }
  return {};
}
function board(showRevenue = true) {
  return OrdersBoard({ restaurant: { id: "r1", currency: "MXN" }, initialOrders: [order],
    initialRequests: [], canCancel: true, canMove: false, canSettle: true,
    isWaiter: false, canApprove: true, showRevenue, collectedToday: 100 });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("React", React);
  state.refusal = null;
  state.cancel.mockResolvedValue(null); state.confirm.mockResolvedValue(true);
});

it("the board's refusal checks its order and refreshes without cancelling", async () => {
  state.refusal = { kind: "orders", orderIds: ["a"] };
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ outcome: "closed" })));
  function findCheck(node: React.ReactNode): React.ReactNode {
    if (!React.isValidElement<NodeProps>(node)) return null;
    if (node.type === CheckPayment) return node;
    for (const child of React.Children.toArray(node.props.children)) {
      const found = findCheck(child); if (found) return found;
    }
    return null;
  }
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(findCheck(board())));
    expect(host.querySelector("button")).not.toBeNull();
    await act(async () => host.querySelector("button")!.click());
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/checkout/check", expect.objectContaining({ body: JSON.stringify(state.refusal) }));
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(state.cancel).not.toHaveBeenCalled(); expect(state.confirm).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
it("invalidates takings after the board's own successful cancel", async () => {
  const event = vi.fn(); window.addEventListener("tt-orders-takings-changed", event, { once: true });
  await find(board(), "onCancel").onCancel!(order);
  expect(event).toHaveBeenCalledTimes(1);
  expect(event.mock.calls[0][0].detail).toBe("r1");
});
it("invalidates takings immediately after the board's own collection", () => {
  const event = vi.fn(); window.addEventListener("tt-orders-takings-changed", event, { once: true });
  find(board(), "onSettled").onSettled!();
  expect(event).toHaveBeenCalledTimes(1); expect(state.refresh).toHaveBeenCalledTimes(1);
});
it("does not request restaurant takings when a floor member collects", () => {
  const event = vi.fn(); window.addEventListener("tt-orders-takings-changed", event);
  find(board(false), "onSettled").onSettled!();
  expect(event).not.toHaveBeenCalled(); expect(state.refresh).toHaveBeenCalledTimes(1);
  window.removeEventListener("tt-orders-takings-changed", event);
});
