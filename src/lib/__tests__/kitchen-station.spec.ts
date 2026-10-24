import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const ticket = "10000000-0000-4000-8000-000000000001";
const order = "20000000-0000-4000-8000-000000000002";
const state = vi.hoisted(() => ({ role: "kitchen", tenant: "r1", failed: false, outcome: "ok", status: "ready", moves: vi.fn() }));
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => ({ role: state.role, restaurantId: "r1" }) }));
vi.mock("@/lib/membership", () => ({ MOVES_ORDERS: (role: string) => !["waiter", "cashier"].includes(role) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number, _vars: unknown, extra: unknown) => NextResponse.json({ ...extra as object, error }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => {
    const filters: [string, unknown][] = [];
    const q = { select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      maybeSingle: async () => {
        const row: Record<string, unknown> = { id: order, kitchen_ticket_id: ticket, restaurant_id: state.tenant };
        return { data: filters.every(([key, value]) => row[key] === value) ? { id: order } : null,
          error: state.failed ? { message: "unread" } : null };
      } };
    return q;
  },
  rpc: (...args: unknown[]) => { state.moves(...args); return { data: { outcome: state.outcome, status: state.status, stations_ready: ["bar"] } }; },
}) }));
const { POST } = await import("@/app/api/orders/station/route");
const send = (id = ticket) => POST(new NextRequest("http://localhost/api/orders/station", {
  method: "POST", body: JSON.stringify({ id, station: "bar" }),
}));
beforeEach(() => { Object.assign(state, { role: "kitchen", tenant: "r1", failed: false, outcome: "ok", status: "ready" }); state.moves.mockClear(); });
it("retires an inactive station ticket without returning the order credential or write-off details", async () => {
  state.outcome = "inactive";
  const response = await send();
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "apiErr.orderInactive", inactive: true });
});
it("keeps a ready station conflict on the board for delivery", async () => {
  state.outcome = "moved";
  const response = await send();
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "apiErr.orderMovedOn" });
});
it("finishes a kitchen station by its separate ticket without returning the order credential", async () => {
  const res = await send();
  expect(res.status).toBe(200);
  expect(state.moves).toHaveBeenCalledWith("mark_station_ready", { p_restaurant: "r1", p_order: order, p_station: "bar" });
  expect(JSON.stringify(await res.json())).not.toContain(order);
});
it("refuses another restaurant's ticket before moving a station", async () => {
  state.tenant = "r2";
  expect((await send()).status).toBe(404);
  expect(state.moves).not.toHaveBeenCalled();
});
it("does not accept a diner order credential as a kitchen ticket", async () => {
  expect((await send(order)).status).toBe(404);
  expect(state.moves).not.toHaveBeenCalled();
});
it("does not move when the ticket lookup fails", async () => {
  state.failed = true;
  expect((await send()).status).toBe(500);
  expect(state.moves).not.toHaveBeenCalled();
});
it.each(["owner", "manager"])("preserves %s station actions using order ids", async role => {
  state.role = role;
  expect((await send(order)).status).toBe(200);
  expect(state.moves).toHaveBeenCalledWith("mark_station_ready", { p_restaurant: "r1", p_order: order, p_station: "bar" });
});
it.each(["waiter", "cashier"])("keeps %s out of station moves", async role => {
  state.role = role;
  expect((await send()).status).toBe(403);
  expect(state.moves).not.toHaveBeenCalled();
});
