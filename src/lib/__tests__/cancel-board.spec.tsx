import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import type { Order } from "@/lib/types";
const cancelPlanFor = vi.fn();
const cancelOrder = vi.fn();
const confirm = vi.fn();
const toast = vi.fn();
const order = { id: "o1", status: "received", created_at: "2026-10-01", items: [] } as unknown as Order;
vi.mock("@/hooks/useRestaurantOrders", () => ({ useRestaurantOrders: () => ({
  orders: [order], inactiveOrderIds: new Set(), hideInactive: vi.fn(), cancelPlanFor, cancelOrder, online: true, pending: 0,
}) }));
vi.mock("@/hooks/useBoardStation", () => ({ useBoardStation: () => [null, vi.fn()] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => confirm }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
const { default: OrdersBoard } = await import("@/components/dashboard/OrdersBoard");
interface NodeProps { children?: React.ReactNode; onCancel?: (order: Order) => Promise<void> }
function findCancel(node: React.ReactNode): NodeProps["onCancel"] {
  if (!React.isValidElement<NodeProps>(node)) return;
  if (node.props.onCancel) return node.props.onCancel;
  for (const child of React.Children.toArray(node.props.children)) {
    const found = findCancel(child);
    if (found) return found;
  }
}
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("React", React); });
describe("the board re-reads a stale cancellation offer", () => {
  it("asks for confirmation of the fresh plan before trying the cancel again", async () => {
    cancelPlanFor.mockResolvedValueOnce({ paid: false, refund: 0, cash: 0, terminal: 0, withTable: 100 })
      .mockResolvedValueOnce({ paid: true, refund: 0, cash: 100, terminal: 0, withTable: 0 });
    cancelOrder.mockResolvedValueOnce({ error: "changed", stale: true }).mockResolvedValueOnce(null);
    confirm.mockResolvedValue(true);
    const tree = OrdersBoard({ restaurant: { id: "r1", currency: "MXN" }, initialOrders: [order],
      initialRequests: [], canCancel: true, canMove: false, canSettle: false,
      isWaiter: false, canApprove: true, showRevenue: false, revenueBase: 0, todayStartMs: 0,
    } as never);
    const cancel = findCancel(tree);
    expect(cancel).toBeDefined();
    await cancel!(order);
    expect(cancelPlanFor).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[0][0].message).not.toEqual(confirm.mock.calls[1][0].message);
    expect(cancelOrder).toHaveBeenCalledTimes(2);
  });
});
