import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  closed: false, movements: [{ id: "00000000-0000-4000-8000-000000000001", amount: 20, note: null }],
  race: true, expected: 80, reads: 0, rpcs: [] as string[],
}));
const shift = { id: "shift", opening_amount: 100, currency: "MXN", opened_at: "2026-10-20T12:00:00Z", closed_at: null };
vi.mock("@/lib/api-guard", () => ({
  actingStaff: async () => ({ restaurantId: "r", email: "cashier", role: "cashier" }),
  actingManager: async () => ({ restaurantId: "r", email: "manager", role: "manager" }),
}));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/cash-shift-server", () => ({
  openShift: async () => {
    state.reads++;
    const copy = { ...shift };
    // Close commits after the route read, before its separate movement write.
    if (state.race) state.closed = true;
    return copy;
  },
  shiftSumOf: async () => ({ opening: 100, cashSales: 0, withdrawn: 20, expected: 80 }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string) => {
    state.rpcs.push(name);
    if (state.race) state.closed = true;
    if (state.closed) return { data: null, error: null };
    if (name === "close_cash_shift") {
      state.closed = true;
      state.expected = 100 - state.movements.reduce((n, m) => n + m.amount, 0);
      return { data: { id: shift.id, currency: "MXN", opening: 100, cashSales: 0, withdrawn: 100 - state.expected,
        expected: state.expected, counted: 80, difference: 80 - state.expected }, error: null };
    }
    if (name === "create_cash_withdrawal") {
      state.movements.push({ id: "new", amount: 10, note: null });
      return { data: { id: "new", currency: "MXN" }, error: null };
    }
    if (name === "delete_cash_withdrawal") {
      return { data: { ...state.movements.splice(0)[0], currency: "MXN" }, error: null };
    }
    return { data: null, error: { message: "unexpected call" } };
  },
  from: () => {
    let action = "read";
    const q: Record<string, unknown> = {};
    for (const key of ["select", "eq", "is"]) q[key] = () => q;
    q.insert = () => { action = "insert"; return q; };
    q.delete = () => { action = "delete"; return q; };
    q.update = () => { action = "update"; return q; };
    const result = () => {
      if (action === "insert") { state.movements.push({ id: "late", amount: 10, note: null }); return { data: { id: "late" }, error: null }; }
      if (action === "delete") { const data = state.movements.splice(0); return { data, error: null }; }
      if (action === "update") { state.closed = true; return { data: [{ id: shift.id }], error: null }; }
      return { data: null, error: null };
    };
    q.single = async () => result();
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return q;
  },
}) }));
const drawer = await import("@/app/api/cash-drawer/route");
const shifts = await import("@/app/api/cash-shift/route");
const request = (body: object) => new NextRequest("http://localhost/api/cash-drawer", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  state.closed = false; state.race = true; state.reads = 0; state.rpcs = []; state.expected = 80;
  state.movements = [{ id: "00000000-0000-4000-8000-000000000001", amount: 20, note: null }];
});

it("I1 refuses a withdrawal when close wins after the open-shift read", async () => {
  const response = await drawer.POST(request({ kind: "withdrawal", amount: 10 }));
  expect(state.movements).toHaveLength(1);
  expect(state.expected).toBe(80);
  expect(response.status).toBe(409);
});
it("I1 refuses deleting a withdrawal when close wins after the open-shift read", async () => {
  const response = await drawer.DELETE(request({ id: state.movements[0].id }));
  expect(state.movements).toHaveLength(1);
  expect(state.expected).toBe(80);
  expect(response.status).toBe(404);
});
it("I1 closes and computes the signed snapshot in one database call", async () => {
  state.race = false;
  const response = await shifts.POST(request({ action: "close", counted: 80, confirm: true }));
  expect(response.status).toBe(200);
  expect(state.rpcs).toEqual(["close_cash_shift"]);
  expect(await response.json()).toMatchObject({ expected: 80, difference: 0 });
});
it("I1 includes a withdrawal that wins the lock before close, and refuses a second close", async () => {
  state.race = false;
  expect((await drawer.POST(request({ kind: "withdrawal", amount: 10 }))).status).toBe(200);
  const response = await shifts.POST(request({ action: "close", counted: 80, confirm: true }));
  expect(await response.json()).toMatchObject({ expected: 70, difference: 10, currency: "MXN" });
  expect((await shifts.POST(request({ action: "close", counted: 80, confirm: true }))).status).toBe(409);
  expect(state.expected).toBe(70);
});
it("I1 excludes a mistaken withdrawal deleted before close", async () => {
  state.race = false;
  expect((await drawer.DELETE(request({ id: state.movements[0].id }))).status).toBe(200);
  const response = await shifts.POST(request({ action: "close", counted: 80, confirm: true }));
  expect(await response.json()).toMatchObject({ expected: 100, difference: -20 });
});
