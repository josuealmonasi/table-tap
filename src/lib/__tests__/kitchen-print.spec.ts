import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = vi.hoisted(() => ({ role: "kitchen", reads: [] as string[], queued: 0,
  filters: [] as [string, unknown][], jobs: [] as object[] }));
vi.mock("@/lib/api-guard", () => ({
  actingStaff: async () => ({ restaurantId: "r1", role: state.role }),
  actingFrontOfHouse: async () => state.role === "kitchen" ? null : { restaurantId: "r1", role: state.role },
}));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/receipt", () => ({ buildReceipt: () => ({ html: "receipt with money" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  state.reads.push(table);
  let offset = 0;
  const q = { range: (start: number) => { offset = start; return q; }, select: () => q, eq: (key: string, value: unknown) => { state.filters.push([key, value]); return q; },
    in: () => q, order: () => q,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "orders" && offset === 0 ? [{ id: "real-order-id", restaurant_id: "r1", currency: "MXN" }] : [], error: null }).then(resolve),
    maybeSingle: async () => ({ data: table === "orders" ? { id: "real-order-id" }
      : { print_token: "printer", name: "Bistro" }, error: null }),
    upsert: async (row: object) => { state.queued++; state.jobs.push(row); return { error: null }; } };
  return q;
} }) }));
const { POST } = await import("@/app/api/orders/print/route");
const send = (to: string) => POST(new NextRequest("http://localhost/api/orders/print", {
  method: "POST", body: JSON.stringify({ orderId: "ticket-id", to }),
}));
beforeEach(() => { state.role = "kitchen"; state.reads.length = 0; state.filters.length = 0; state.queued = 0; state.jobs.length = 0; });
it("refuses the kitchen's receipt before reading money or building paper", async () => {
  const res = await send("receipt");
  expect(res.status).toBe(403);
  expect(await res.json()).not.toHaveProperty("html");
  expect(state.reads).toEqual([]);
  expect(state.queued).toBe(0);
});
it("still reprints a kitchen ticket using its separate, tenant-scoped id", async () => {
  const res = await send("kitchen");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ queued: true });
  expect(state.queued).toBe(1);
  expect(state.filters).toContainEqual(["kitchen_ticket_id", "ticket-id"]);
  expect(state.filters).toContainEqual(["restaurant_id", "r1"]);
  expect(state.jobs[0]).toMatchObject({ order_id: "real-order-id", kind: "kitchen", claimed_at: null, printed_at: null });
});
it.each(["owner", "manager", "waiter", "cashier"])("keeps receipts for %s", async role => {
  state.role = role;
  const res = await send("receipt");
  expect(res.status).toBe(200);
  expect(await res.json()).toHaveProperty("html", "receipt with money");
  expect(state.filters).toContainEqual(["id", "ticket-id"]);
});
