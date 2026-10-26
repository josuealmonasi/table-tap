import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const orderId = "10000000-0000-4000-8000-000000000001";
const ticketId = "20000000-0000-4000-8000-000000000002";
const state = vi.hoisted(() => ({
  role: "kitchen", status: "received", writtenOff: false, tenant: "r1",
  readError: false, writeError: false, affected: 1, writeOffRace: false, writes: vi.fn(), filters: [] as unknown[][],
}));
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => ({ role: state.role, restaurantId: "r1" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number, _vars: unknown, extra: unknown) =>
  NextResponse.json({ ...extra as object, error }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  const filters: [string, unknown][] = [];
  let writing = false;
  const q = {
    eq: (key: string, value: unknown) => { filters.push([key, value]); state.filters.push([key, value]); return q; },
    update: (value: unknown) => { writing = true; state.writes(value); return q; },
    select: () => {
      if (!writing) return q;
      if (state.writeOffRace) state.writtenOff = true;
      return Promise.resolve({ data: Array(state.affected).fill({ id: orderId }), error: state.writeError ? {} : null });
    },
    maybeSingle: async () => {
      const row: Record<string, unknown> = { id: orderId, kitchen_ticket_id: ticketId, restaurant_id: state.tenant };
      return { data: filters.every(([key, value]) => row[key] === value)
        ? { id: orderId, status: state.status, written_off: state.writtenOff } : null,
        error: state.readError ? {} : null };
    },
  };
  return q;
} }) }));
import { PATCH } from "@/app/api/orders/route";
const send = (status = "preparing", from = state.status, id = state.role === "kitchen" ? ticketId : orderId) =>
  PATCH(new NextRequest("http://localhost/api/orders", { method: "PATCH", body: JSON.stringify({ id, status, from }) }));
beforeEach(() => {
  Object.assign(state, { role: "kitchen", status: "received", writtenOff: false, tenant: "r1",
    readError: false, writeError: false, affected: 1, writeOffRace: false }); state.writes.mockClear(); state.filters.length = 0;
});
it.each(["kitchen", "owner", "manager"])("retires a written-off %s ticket without writing or leaking financial facts", async role => {
  state.role = role; state.writtenOff = true;
  const response = await send();
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "apiErr.orderInactive", inactive: true });
  expect(state.writes).not.toHaveBeenCalled();
});
it.each(["completed", "cancelled", "pending_payment"])("retires a stale %s ticket without reopening it", async status => {
  state.status = status; const response = await send();
  expect(await response.json()).toEqual({ error: "apiErr.orderInactive", inactive: true });
  expect(state.writes).not.toHaveBeenCalled();
});
it.each([["received", "preparing"], ["preparing", "ready"], ["ready", "completed"], ["ready", "received"]])(
  "preserves a normal %s -> %s move with tenant, status and write-off guards", async (from, to) => {
    state.status = from; const response = await send(to);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
    expect(state.filters).toContainEqual(["status", from]);
    expect(state.filters).toContainEqual(["written_off", false]);
    expect(state.filters).toContainEqual(["restaurant_id", "r1"]);
    expect(state.writes).toHaveBeenCalledWith({ status: to });
  });
it("keeps ordinary stage conflicts distinct from inactive orders", async () => {
  const response = await send("preparing", "ready");
  expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "apiErr.orderMoveChanged" });
  expect(state.writes).not.toHaveBeenCalled();
});
it.each(["waiter", "cashier"])("keeps %s out of preparation but allows handing over ready food", async role => {
  state.role = role; expect((await send()).status).toBe(403); expect(state.writes).not.toHaveBeenCalled();
  state.status = "ready"; expect((await send("completed")).status).toBe(200);
});
it("does not accept an order credential as a kitchen ticket", async () => {
  expect((await send("preparing", "received", orderId)).status).toBe(403); expect(state.writes).not.toHaveBeenCalled();
});
it("does not move another restaurant's order", async () => {
  state.tenant = "r2"; expect((await send()).status).toBe(403); expect(state.writes).not.toHaveBeenCalled();
});
it("fails closed on an unreadable order", async () => {
  state.readError = true; expect((await send()).status).toBe(500); expect(state.writes).not.toHaveBeenCalled();
});
it("refuses a lost compare-and-set rather than claiming success", async () => {
  state.affected = 0; expect((await send()).status).toBe(409);
});
it("retires a card when a write-off wins between its read and compare-and-set", async () => {
  state.affected = 0; state.writeOffRace = true;
  const response = await send();
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "apiErr.orderInactive", inactive: true });
});
