import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const s = vi.hoisted(() => ({ calls: [] as { name: string; args: unknown }[], verified: true, events: [] as string[] }));
const { resolve, close, log } = vi.hoisted(() => ({ resolve: vi.fn(), close: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/whole-bill-pages", () => ({ resolveCheckoutPages: resolve }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => ({ restaurantId: "r1", email: "cashier", role: "manager" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/accounts-server", () => ({ accountById: async () => ({ id: "a", name: "Ana" }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: log }));
vi.mock("@/lib/table-session", () => ({ closeSessionsFor: close }));
vi.mock("@/lib/part-payment", () => ({ closeBill: close, summary: () => ({}) }));
vi.mock("@/lib/table-outstanding", () => ({ tableOutstanding: async () => ({ owed: 0, orders: [{ table_label: "1" }] }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string, args: unknown) => {
    s.calls.push({ name, args }); s.events.push("write");
    if (s.calls.length === 1 || !s.verified) return name === "settle_orders_v2"
      ? { data: null, error: { message: "paying" } } : { data: { outcome: "paying" }, error: null };
    return { data: name === "settle_orders_v2" ? 1 : {
      outcome: name === "account_charge_v2" ? "charged" : "written", amount: 100, tip: 0, owed: 0, currency: "MXN",
    }, error: null };
  },
  from: () => {
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "is", "neq"]) q[op] = () => q;
    q.maybeSingle = async () => ({ data: { currency: "MXN" }, error: null });
    q.then = (done: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: "o1", total: 100, table_label: "1", session_id: "s" }], error: null }).then(done);
    return q;
  },
}) }));
const { POST: full } = await import("@/app/api/table-payment/route");
const { POST: part } = await import("@/app/api/table-payment/part/route");
const { POST: transfer } = await import("@/app/api/accounts/charge/route");
const cases = [
  ["whole table", full, { tableId: "t", settlement: "cash", expected: 100, currency: "MXN", ref: "original" }],
  ["part of a table", part, { tableId: "t", amount: 100, method: "card", expected: 100, currency: "MXN", ref: "original" }],
  ["counter order", full, { orderId: "o1", settlement: "cash" }],
  ["account transfer", transfer, { accountId: "a", orderIds: ["o1"], expected: 100 }],
] as const;
beforeEach(() => {
  vi.clearAllMocks(); s.calls = []; s.events = []; s.verified = true;
  resolve.mockImplementation(async () => { s.events.push("resolve"); return s.verified ? "closed" : "unverified"; });
  close.mockResolvedValue(true);
});
it.each(cases)("%s retries only after resolution, using the same quote", async (_label, post, body) => {
  const res = await post(new NextRequest("https://test/api/collect", { method: "POST", body: JSON.stringify(body) }));
  expect(res.status).toBe(200); expect(s.calls).toHaveLength(2); expect(s.calls[1]).toEqual(s.calls[0]);
  expect(s.events.slice(0, 3)).toEqual(["write", "resolve", "write"]);
  if (s.calls[0].name === "account_charge_v2") {
    expect(resolve.mock.calls[0][1]).toMatchObject({ orderIds: ["o1"], accountId: undefined });
  }
});
it.each(cases)("%s cannot close or log success when the page is unverified", async (_label, post, body) => {
  s.verified = false;
  const res = await post(new NextRequest("https://test/api/collect", { method: "POST", body: JSON.stringify(body) }));
  expect(res.status).toBe(409); expect(s.calls).toHaveLength(1); expect(close).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled();
});
