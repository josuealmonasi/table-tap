import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// bl33 #1: a waiter's round must land on the sitting that is open, or not at
// all. The helper's null and a sitting closed under the round both refuse, put
// the stock back, and save nothing.
const TABLE = "00000000-0000-4000-8000-0000000000f3";
const REF = "00000000-0000-4000-8000-0000000000aa";
const state = vi.hoisted(() => ({
  session: "s" as string | null, inserted: "o" as string | null,
  rpc: vi.fn(), release: vi.fn(), intent: vi.fn(),
}));
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => ({ restaurantId: "r", role: "owner", email: "owner" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => null }));
vi.mock("@/lib/staff-request-guard", () => ({ staffWriteLimited: async () => false }));
vi.mock("@/lib/promotions-on-sale", () => ({ promotionsOnSale: async () => [] }));
vi.mock("@/lib/checkout/orderable-now", () => ({ orderableNow: async () => ({ closedNow: false, onOpenMenu: () => true }) }));
vi.mock("@/lib/checkout/verified-lines", () => ({ verifiedLines: async (_db: unknown, _r: string, { items }: { items: unknown[] }) => ({ ok: true, lines: items }) }));
vi.mock("@/lib/table-session", () => ({ openSession: async () => state.session }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/order-intent", () => ({ readOrderIntent: async () => null, writeOrderIntent: state.intent }));
vi.mock("@/lib/stock-service", () => ({
  reserveStock: async () => ({ ok: true, reservationId: "res", low: [] }),
  releaseStock: state.release, raiseStockNotifications: async () => {},
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (...args: unknown[]) => { state.rpc(...args); return { data: state.inserted, error: null }; },
  from: (table: string) => {
    const row = table === "restaurants" ? { id: "r", currency: "MXN", low_stock_threshold: 2 } : { id: TABLE, label: "1" };
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row, error: null }) };
    return q;
  },
}) }));
const { POST } = await import("../route");
const send = (ref?: string) => POST(new NextRequest("https://test/api/table-order", {
  method: "POST",
  body: JSON.stringify({ tableId: TABLE, ref, items: [{ itemId: "dish", name: "Dish", price: 10, qty: 1 }] }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { session: "s", inserted: "o" });
  state.intent.mockResolvedValue({ orderId: "o", sessionId: "s", table: "1", total: 10 });
});

it("saves the round through the sitting-locked writer", async () => {
  expect((await send()).status).toBe(200);
  expect(state.rpc).toHaveBeenCalledWith("create_table_order_v2", expect.objectContaining({
    p_restaurant: "r", p_order: expect.objectContaining({ session_id: "s", stock_reservation_id: "res" }),
  }));
});

it("refuses and releases the stock when no sitting could be opened", async () => {
  state.session = null;
  const res = await send();
  expect(res.status).toBe(503);
  expect((await res.json()).error).toBe("apiErr.tableBillUnavailable");
  expect(state.rpc).not.toHaveBeenCalled();
  expect(state.release).toHaveBeenCalledWith("r", "res");
});

it("refuses and releases the stock when the sitting closed before the insert", async () => {
  state.inserted = null;
  const res = await send();
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("apiErr.tableBillClosed");
  expect(state.release).toHaveBeenCalledWith("r", "res");
});

it("asks the retry writer to hold the sitting open, and refuses a closed one", async () => {
  state.intent.mockResolvedValue({ sittingClosed: true });
  const res = await send(REF);
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("apiErr.tableBillClosed");
  expect(state.intent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ openSitting: true }));
});

it("refuses a retried round too when no sitting could be opened", async () => {
  state.session = null;
  expect((await send(REF)).status).toBe(503);
  expect(state.intent).not.toHaveBeenCalled();
});

it("closes and inserts under the same sitting row lock in SQL", async () => {
  const { readFileSync } = await import("node:fs");
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const fn = (name: string): string => {
    const start = schema.indexOf(`create or replace function public.${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    return schema.slice(start, schema.indexOf("$$;", start));
  };
  const close = fn("close_session_if_clear_v2");
  // The closer holds the row BEFORE it counts what is owed.
  expect(close.indexOf("for update;")).toBeGreaterThan(-1);
  expect(close.indexOf("for update;")).toBeLessThan(close.indexOf("select count(*) into v_owing"));
  expect(fn("close_session_if_clear")).toContain("select public.close_session_if_clear_v2(p_session, p_reason);");
  for (const writer of ["create_table_order_v2", "create_table_order_intent_v2"]) {
    const body = fn(writer);
    expect(body, writer).toContain("closed_at is null\n   for share;");
    expect(body.indexOf("for share;"), writer).toBeLessThan(body.search(/insert into orders|create_order_intent\(/));
  }
  expect(readFileSync("src/lib/table-session.ts", "utf8")).toContain('rpc("close_session_if_clear_v2"');
});
