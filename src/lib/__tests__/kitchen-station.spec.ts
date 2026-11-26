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
  method: "POST", body: JSON.stringify({ id, station: "bar", revision: 0 }),
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
  expect(state.moves).toHaveBeenCalledWith("mark_station_ready_v2", { p_restaurant: "r1", p_order: order, p_station: "bar", p_revision: 0 });
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
  expect(state.moves).toHaveBeenCalledWith("mark_station_ready_v2", { p_restaurant: "r1", p_order: order, p_station: "bar", p_revision: 0 });
});
it.each(["waiter", "cashier"])("keeps %s out of station moves", async role => {
  state.role = role;
  expect((await send()).status).toBe(403);
  expect(state.moves).not.toHaveBeenCalled();
});

// bl33 #3: a "done" sent before the ticket was sent back must not count toward
// the new preparation cycle.
it("refuses a completion from an earlier preparation cycle", async () => {
  state.outcome = "stale";
  const response = await send();
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "apiErr.stationStale" });
});
it("refuses a completion that names no cycle, without moving anything", async () => {
  const response = await POST(new NextRequest("http://localhost/api/orders/station", {
    method: "POST", body: JSON.stringify({ id: ticket, station: "bar" }),
  }));
  expect(response.status).toBe(409);
  expect(state.moves).not.toHaveBeenCalled();
});
it("bumps the cycle on every rewind and checks it under the order lock", async () => {
  const { readFileSync } = await import("node:fs");
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const fn = (name: string): string => {
    const start = schema.indexOf(`create or replace function public.${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    return schema.slice(start, schema.indexOf("$$;", start));
  };
  expect(schema).toContain("alter table orders add column if not exists prep_revision int not null default 0;");
  expect(schema).toContain("alter table kitchen_tickets add column if not exists prep_revision int not null default 0;");
  expect(fn("bump_prep_revision_v1")).toContain("new.prep_revision := old.prep_revision + 1;");
  expect(schema).toContain("before update of status on orders\n  for each row execute function public.bump_prep_revision_v1();");
  const writer = fn("mark_station_ready_v2");
  const lock = writer.indexOf("for update;");
  expect(lock).toBeGreaterThan(-1);
  expect(writer.indexOf("p_revision is distinct from v_order.prep_revision")).toBeGreaterThan(lock);
  expect(writer.indexOf("'outcome', 'stale'")).toBeLessThan(writer.indexOf("return public.mark_station_ready("));
  // The pass reads kitchen_tickets, so the revision has to reach it.
  expect(fn("sync_kitchen_ticket_v2")).toContain("prep_revision = excluded.prep_revision");
  expect(schema).toContain("for each row execute function public.sync_kitchen_ticket_v2();");
  // And the board sends back the cycle it rendered.
  expect(readFileSync("src/components/dashboard/OrdersBoard.tsx", "utf8"))
    .toContain("revision: byId.get(id)?.prep_revision ?? 0");
});
