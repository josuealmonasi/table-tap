import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const s = vi.hoisted(() => ({ outcome: "collected", actor: true, foreign: false, left: 55, receiptTip: 5, logs: [] as Record<string, unknown>[], args: null as Record<string, unknown> | null }));
vi.mock("@/lib/table-outstanding", () => ({ tableOutstanding: async () => ({ owed: s.left, orders: [{ table_label: "Table 1" }], balances: [] }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async (event: Record<string, unknown>) => { s.logs.push(event); } }));
const r = "00000000-0000-0000-0000-000000000001";
const t = "00000000-0000-0000-0000-000000000002";
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => s.actor ? { restaurantId: s.foreign ? t : r, email: "waiter" } : null }));
vi.mock("@/lib/table-session", () => ({ closeSessionsFor: async () => {} }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number, _vars: unknown, extra: object) => Response.json({ error, ...extra }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => { const q = { select: () => q, eq: () => q, single: async () => ({ data: { amount: 60, tip: s.receiptTip, currency: "MXN", method: "cash" }, error: null }), maybeSingle: async () => ({ data: table === "payments" ? { amount: 60, tip: s.receiptTip, currency: "MXN", method: "cash" } : { id: t }, error: null }) }; return q; },
  rpc: async (_name: string, args: Record<string, unknown>) => { s.args = args; return { data: { outcome: s.outcome, payment: "receipt", amount_cents: 6000, tip_cents: 500 }, error: null }; },
}) }));
const { POST } = await import("@/app/api/split/collect/route");
const body = { restaurantId: r, tableId: t, sessionId: t, splitId: t, revision: 1, slots: [0], expectedCents: 5500,
  currency: "MXN", tipCents: 500, method: "cash", ref: "collection-1" };
const req = (data: unknown = body) => new NextRequest("http://localhost/api/split/collect", { method: "POST", body: JSON.stringify(data) });
beforeEach(() => { s.outcome = "collected"; s.actor = true; s.foreign = false; s.args = null; s.logs = []; s.left = 55; s.receiptTip = 5; });
it.each(["cash", "card"])("collects slots by %s with the trusted collector and exact reviewed cents", async method => {
  expect((await POST(req({ ...body, method }))).status).toBe(200);
  expect(s.args).toMatchObject({ p_restaurant: r, p_split: t, p_actor: "waiter", p_method: method, p_expected_cents: 5500, p_tip_cents: 500 });
});
it.each(["duplicate", "paid", "reserved", "stale", "changed", "conflict", "currency", "gone", "invalid"])("preserves the writer's %s result", async outcome => {
  s.outcome = outcome;
  const response = await POST(req());
  expect(response.status).toBe(outcome === "duplicate" ? 200 : outcome === "invalid" ? 400 : 409);
  expect(await response.json()).toMatchObject({ outcome });
});
it.each(["kitchen", "foreign"])("%s cannot reach the collector", async actor => {
  if (actor === "kitchen") s.actor = false; else s.foreign = true;
  expect((await POST(req())).status).toBe(403);
  expect(s.args).toBeNull();
});
it("refuses a mistyped tip instead of quietly reducing money handed over", async () => {
  expect((await POST(req({ ...body, tipCents: 5501 }))).status).toBe(400);
  expect(s.args).toBeNull();
});

it.each([[55, "collected"], [0, "paid"]])("logs the actual drawer amount and tip when %s remains", async (left, action) => {
  s.left = Number(left);
  expect((await POST(req())).status).toBe(200);
  expect(s.logs).toEqual([{ restaurantId: r, actor: "waiter", entity: "bill", action,
    detail: `table=Table_1 amount=60.00 tip=5.00 currency=MXN method=cash${left ? " left=55.00" : ""}` }]);
});
it("a repeated collection never adds a second cashier activity entry", async () => {
  s.outcome = "duplicate";
  expect((await POST(req())).status).toBe(200);
  expect(s.logs).toEqual([]);
});

it("cashier activity keeps the unpaid tip already inside a frozen part", async () => {
  s.receiptTip = 7.5;
  expect((await POST(req())).status).toBe(200);
  expect(s.logs[0].detail).toContain("amount=60.00 tip=7.50");
});
