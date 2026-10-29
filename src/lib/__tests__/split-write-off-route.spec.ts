import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const state = vi.hoisted(() => ({ role: "manager", paid: 0, outcome: "forgiven", inserts: [] as unknown[],
  rpcs: [] as { name: string; args: Record<string, unknown> }[], filters: [] as unknown[][] }));
vi.mock("@/lib/api-guard", () => ({
  actingFrontOfHouse: async () => state.role === "kitchen" ? null : ({ restaurantId: "r", email: "staff", role: state.role }),
  actingManager: async () => ["owner", "manager"].includes(state.role) ? ({ restaurantId: "r", email: "boss", role: state.role }) : null,
}));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/table-session", () => ({ closeSessionsFor: async () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.rpcs.push({ name, args });
    if (name === "retained_order_coverage") return { data: args.p_order === "first" ? state.paid : 0, error: null };
    if (name === "write_off_remainder_v1") return { data: { outcome: state.outcome, forgiven_cents: state.paid ? 5000 : 10000, sessions: [] }, error: null };
    return { data: name === "approve_write_off_request_v2" ? "split" : { outcome: "split" }, error: null };
  },
  from: (table: string) => {
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "is", "in"]) q[op] = (...args: unknown[]) => { state.filters.push([table, op, ...args]); return q; };
    q.insert = (row: unknown) => { state.inserts.push(row); return q; };
    const result = () => ({ error: null, data: table === "orders" ? ["first", "second"].map(id => ({
      id, total: 50, session_id: "session", paid: false, written_off: false, status: "received", currency: "MXN", table_id: "table",
    })) : table === "bill_splits" ? [{ order_ids: ["first", "second"] }] : {
      id: "ask", order_ids: ["first", "second"], amount: 100 - state.paid, reason: "walkout", status: "pending",
    } });
    q.maybeSingle = async () => result();
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return q;
  },
}) }));
const { POST } = await import("@/app/api/bill/write-off/route");
const { POST: approve } = await import("@/app/api/bill/write-off/approve/route");
const request = (body: unknown) => new NextRequest("http://localhost/api/bill/write-off", { method: "POST", body: JSON.stringify(body) });
const body = () => ({ orderIds: ["first", "second"], expectedCents: (100 - state.paid) * 100, reason: "walkout" });
beforeEach(() => { state.role = "manager"; state.paid = 0; state.outcome = "forgiven"; state.rpcs = []; state.inserts = []; state.filters = []; });
it.each([0, 50])("uses the remainder writer for a reviewed split with %s paid", async paid => {
  state.paid = paid;
  const res = await POST(request(body()));
  expect(res.status).toBe(200);
  expect(state.rpcs).toContainEqual({ name: "write_off_remainder_v1", args: expect.objectContaining({ p_orders: ["first", "second"], p_expected_cents: (100 - paid) * 100 }) });
  expect(state.rpcs.some(r => r.name === "write_off_orders")).toBe(false);
});
it("refuses a changed reviewed amount before writing or requesting", async () => {
  const res = await POST(request({ ...body(), expectedCents: 9999 }));
  expect(res.status).toBe(409); expect(await res.json()).toEqual({ error: "apiErr.writeOffChanged" });
  expect(state.rpcs.every(r => r.name === "retained_order_coverage")).toBe(true); expect(state.inserts).toEqual([]);
});
it.each(["split", "paying", "changed"])("explains the writer's %s refusal without reporting success", async outcome => {
  state.outcome = outcome; state.paid = 50;
  const res = await POST(request(body()));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: `apiErr.writeOff${outcome[0].toUpperCase()}${outcome.slice(1)}` });
});
it.each(["waiter", "cashier"])("records %s's whole split and remainder for a manager", async role => {
  state.role = role; state.paid = 50;
  const res = await POST(request(body()));
  expect(await res.json()).toMatchObject({ pending: true, amount: 50 });
  expect(state.inserts).toEqual([expect.objectContaining({ order_ids: ["first", "second"], amount: 50 })]);
  expect(state.rpcs.some(r => r.name === "write_off_remainder_v1")).toBe(false);
});
it.each([0, 50])("approval uses the remainder writer even with %s paid", async paid => {
  state.paid = paid;
  const res = await approve(request({ requestId: "ask", approve: true, reviewedAmount: 100 - paid }));
  expect(res.status).toBe(200);
  expect(state.rpcs).toContainEqual({ name: "write_off_remainder_v1", args: expect.objectContaining({ p_orders: ["first", "second"], p_request: "ask", p_expected_cents: (100 - paid) * 100 }) });
});
it("keeps kitchen out before any financial read", async () => {
  state.role = "kitchen";
  expect((await POST(request(body()))).status).toBe(403);
  expect(state.filters).toEqual([]); expect(state.rpcs).toEqual([]);
});

it.each(["split", "paying", "changed"])("approval leaves the request undecided on %s", async outcome => {
  state.paid = 50; state.outcome = outcome;
  const res = await approve(request({ requestId: "ask", approve: true, reviewedAmount: 50 }));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: `apiErr.writeOff${outcome[0].toUpperCase()}${outcome.slice(1)}` });
  expect(state.inserts).toEqual([]);
});
it.each(["waiter", "cashier", "kitchen"])("%s cannot approve a request", async role => {
  state.role = role;
  expect((await approve(request({ requestId: "ask", approve: true, reviewedAmount: 100 }))).status).toBe(403);
  expect(state.filters).toEqual([]); expect(state.rpcs).toEqual([]);
});
