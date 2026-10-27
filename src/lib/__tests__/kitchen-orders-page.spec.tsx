import { beforeEach, expect, it, vi } from "vitest";
import * as React from "react";

const state = vi.hoisted(() => ({ role: "kitchen", reads: [] as string[], filters: [] as unknown[][] }));
const ticket = { id: "ticket-id", code: "1234", status: "received", items: [], created_at: "2026-10-20" };
const call = { id: "call-id", kind: "bill", table_label: "8", status: "open" };
vi.mock("@/lib/membership", () => ({
  getMembership: async () => ({ role: state.role, restaurant: { id: "r1", currency: "MXN", subscribed_price: 999 } }),
  MANAGES: (role: string) => ["owner", "manager"].includes(role),
  MOVES_ORDERS: () => true, SETTLES: (role: string) => role !== "kitchen", TAKES_COUNTER_ORDERS: () => false,
}));
vi.mock("@/lib/current-user", () => ({ currentUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => null }));
vi.mock("@/lib/collected-today", () => ({ collectedToday: async () => 0 }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  state.reads.push(table);
  const q = { select: () => q, eq: (...args: unknown[]) => { state.filters.push([table, ...args]); return q; }, in: () => q, neq: () => q, gte: () => q,
    order: () => q, then: (resolve: (v: unknown) => unknown) => Promise.resolve({
      data: table === "orders" ? [{ ...ticket, id: "real-order-id", total: 123, paid: true, items: [{ price: 123 }] }]
        : table === "kitchen_tickets" ? [ticket] : table === "kitchen_requests" ? [call]
          : table === "service_requests" ? [{ ...call, table_id: "table-credential" }] : [], count: 0,
    }).then(resolve) };
  return q;
} }) }));
const { default: OrdersPage } = await import("@/app/dashboard/orders/page");
beforeEach(() => { state.reads.length = 0; state.filters.length = 0; state.role = "kitchen"; vi.stubGlobal("React", React); });
it("seeds the kitchen board with tickets, without order money or diner lookup ids", async () => {
  const page = await OrdersPage();
  const board = page.props.children;
  expect(board.props.initialOrders).toEqual([ticket]);
  expect(state.reads).not.toContain("orders");
  expect(state.reads).not.toContain("service_requests");
  expect(state.filters.some(filter => filter[1] === "written_off")).toBe(false);
  expect(board.props.initialRequests).toEqual([call]);
  expect(board.props.kitchen).toBe(true);
  expect(board.props.restaurant).toEqual({ id: "r1", currency: "MXN" });
});
it.each(["owner", "manager", "waiter", "cashier"])("keeps full orders for %s", async role => {
  state.role = role;
  const page = await OrdersPage();
  expect(page.props.children.props.initialOrders[0].total).toBe(123);
  expect(state.filters).toContainEqual(["orders", "written_off", false]);
  expect(state.reads).not.toContain("kitchen_tickets");
  expect(page.props.children.props.initialRequests[0].table_id).toBe("table-credential");
});
