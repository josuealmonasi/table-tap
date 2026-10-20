import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { issueOfflineContext } from "@/lib/offline-authority";

const state = vi.hoisted(() => ({
  role: "cashier", email: "cashier@example.com", blocked: false, matching: false, calls: [] as { name: string; args: Record<string, unknown> }[],
  queued: null as Record<string, unknown> | null,
}));
vi.mock("@/lib/api-guard", () => ({
  actingStaff: async () => ({ restaurantId: "r", role: state.role, email: state.email }),
  actingManager: async () => ["owner", "manager"].includes(state.role) ? { restaurantId: "r", role: state.role, email: state.email } : null,
}));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number, _: unknown, extra: object = {}) => Response.json({ error: `Translated: ${error}`, ...extra }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => state.blocked ? Response.json({ error: "frozen" }, { status: 402 }) : null,
  planBlocks: async () => state.blocked ? Response.json({ error: "plan" }, { status: 403 }) : null }));
vi.mock("@/lib/offline-pricing", () => ({ currentOfflinePrice: async () => ({ price: { subtotal: 100, serviceFee: 0, tip: 0, discount: 0, total: 100 }, lines: [] }), sameOfflinePrice: () => state.matching }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    const q: Record<string, unknown> = {};
    let restaurantId: unknown;
    for (const key of ["select", "eq", "is", "order", "range"]) q[key] = () => q;
    q.eq = (key: string, value: unknown) => { if (key === "restaurant_id") restaurantId = value; return q; };
    const result = () => ({ data: table === "restaurants" ? { currency: "MXN" } : table === "offline_sale_queue" && (!state.queued?.restaurant_id || state.queued.restaurant_id === restaurantId) ? state.queued : null, error: null });
    q.single = q.maybeSingle = async () => result();
    return q;
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.calls.push({ name, args });
    if (name === "queue_offline_sale") return { data: { queued: true, orderId: args.p_ref, receipt: args.p_body }, error: null };
    return { data: { outcome: "settled", settled: true, orderId: args.p_ref, total: 80, currency: "USD", method: "cash" }, error: null };
  },
}) }));
const { POST } = await import("@/app/api/pos/order/route");
const upload = await import("@/app/api/pos/upload/route");
const recovery = await import("@/app/api/pos/recover/route");
const body = () => ({ posRef: "6b1f0c2e-0000-4000-8000-000000000001", restaurantId: "r", method: "cash", currency: "MXN",
  collectorContext: issueOfflineContext("r", "cashier@example.com", "MXN", Date.now() - 60_000),
  items: [{ itemId: "dish", name: "Dish", price: 80, qty: 1, mods: {} }],
  offline: { at: new Date().toISOString(), subtotal: 80, serviceFee: 0, tip: 0, discount: 0, total: 80 },
});
const request = (data: unknown) => new NextRequest("http://localhost/api/pos/order", { method: "POST", body: JSON.stringify(data) });
beforeEach(() => { state.calls = []; state.role = "cashier"; state.email = "cashier@example.com"; state.blocked = false; state.matching = false; state.queued = null; process.env.SUPABASE_SECRET_KEY = "test-offline-secret"; });

it("queues a price difference as collected instead of leaving it on the device", async () => {
  const sent = body();
  const res = await POST(request(sent));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ queued: true, receipt: sent });
  expect(state.calls.map(c => c.name)).toEqual(["queue_offline_sale"]);
});
it("queues held money after a freeze or downgrade without reopening new sales", async () => {
  state.blocked = true;
  expect((await POST(request(body()))).status).toBe(200);
  expect(state.calls[0]?.name).toBe("queue_offline_sale");
  const { offline: _, ...online } = body(); void _;
  expect((await POST(request(online))).status).toBe(402);
});
it("queues a receipt older than 30 days and a receipt in its original foreign currency", async () => {
  for (const receipt of [{ ...body(), offline: { ...body().offline, at: "2026-01-01T12:00:00Z" } }, { ...body(), currency: "USD", collectorContext: issueOfflineContext("r", state.email, "USD") }]) {
    expect((await POST(request(receipt))).status).toBe(200);
  }
  expect(state.calls.every(c => c.name === "queue_offline_sale")).toBe(true);
});
it("never trusts a caller-supplied original collector", async () => {
  const { collectorContext: _, ...legacy } = body(); void _;
  expect((await POST(request({ ...legacy, collector: "victim@example.com" }))).status).toBe(200);
  expect(state.calls[0].args.p_collector).toBeNull();
});
it("does not allow a cashier to approve or a manager to supply an unqueued receipt", async () => {
  const data = { ...body(), approval: { confirmed: true, reason: "Receipt checked", collector: "cashier@example.com" } };
  expect((await recovery.POST(request(data))).status).toBe(403);
  state.role = "manager";
  expect((await recovery.POST(request(data))).status).toBe(409);
  expect(state.calls).toEqual([]);
});

it("approves only the stored amount, original collector and original currency after a freeze", async () => {
  state.role = "manager"; state.email = "manager@example.com"; state.blocked = true;
  const original = { ...body(), currency: "USD", collectorContext: issueOfflineContext("r", "original@example.com", "USD") };
  state.queued = { body: original, collector: "original@example.com", currency: "USD" };
  const res = await recovery.POST(request({ posRef: original.posRef, restaurantId: "r", offline: { total: 999 },
    approval: { confirmed: true, reason: "Original receipt checked", currency: "USD", collector: "original@example.com" } }));
  expect(res.status).toBe(200);
  expect(state.calls[0]).toMatchObject({ name: "record_offline_sale", args: { p_actor: "original@example.com", p_manager: state.email,
    p_order: { total: 80, currency: "USD", offline_drift: null } } });
});
it("refuses attempts to replace the original collector or currency on an already queued receipt", async () => {
  state.role = "manager";
  state.queued = { body: body(), collector: "original@example.com", currency: "MXN" };
  for (const override of [{ collector: "other@example.com" }, { currency: "USD" }]) {
    expect((await recovery.POST(request({ posRef: body().posRef, restaurantId: "r", approval: { confirmed: true, reason: "Receipt checked", ...override } }))).status).toBe(409);
  }
  expect(state.calls).toEqual([]);
});
it("does not queue invalid money or another restaurant's receipt", async () => {
  expect((await POST(request({ ...body(), restaurantId: "other" }))).status).toBe(409);
  expect((await POST(request({ ...body(), offline: { ...body().offline, total: 999 } }))).status).toBe(400);
  expect(state.calls).toEqual([]);
});
it("queues a device clock error for manager correction without changing the saved timestamp", async () => {
  const sent = { ...body(), offline: { ...body().offline, at: "2099-01-01T12:34:56Z" } };
  const res = await POST(request(sent));
  expect(res.status).toBe(200);
  expect(state.calls[0]).toMatchObject({ name: "queue_offline_sale", args: { p_body: sent, p_reason: "recovery.clockCheck" } });
});

it("uploads only to the queue even when a receipt matches today's menu and selling is allowed", async () => {
  state.matching = true;
  const sent = body();
  const res = await upload.POST(request(sent));
  expect(res.status).toBe(200);
  expect(state.calls.map(c => c.name)).toEqual(["queue_offline_sale"]);
  expect(await res.json()).toMatchObject({ queued: true, receipt: sent });
});
it("keeps queue visibility and comparison manager-only and refuses new or cross-tenant uploads", async () => {
  expect((await recovery.GET(request(body()))).status).toBe(403);
  expect((await upload.POST(request({ ...body(), restaurantId: "other" }))).status).toBe(409);
  const { offline: _, ...newSale } = body(); void _;
  expect((await upload.POST(request(newSale))).status).toBe(400);
  state.role = "kitchen";
  expect((await upload.POST(request(body()))).status).toBe(403);
  expect(state.calls).toEqual([]);
});

it("returns a server comparison of the stored receipt only to a manager", async () => {
  state.role = "manager";
  state.queued = { body: body(), collector: "cashier@example.com", currency: "MXN" };
  const req = new NextRequest("http://localhost/api/pos/recover?posRef=stored");
  const res = await recovery.GET(req);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ comparison: { currency: "MXN", charge: { total: 100 }, difference: -20 } });
  state.role = "cashier";
  expect((await recovery.GET(req)).status).toBe(403);
});

it("does not compare a queued receipt belonging to another restaurant", async () => {
  state.role = "manager";
  state.queued = { restaurant_id: "other", body: body(), currency: "MXN" };
  const res = await recovery.GET(new NextRequest("http://localhost/api/pos/recover?posRef=foreign"));
  expect(res.status).toBe(404);
  expect(state.calls).toEqual([]);
});
