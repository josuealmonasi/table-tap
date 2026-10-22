import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
interface Deposit { id: string; restaurant_id: string; sales_day: string; currency: string | null; expected: number; received: number }
const state = vi.hoisted(() => ({ role: "manager", rows: [] as Deposit[], log: vi.fn(), priced: vi.fn() }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => state.role === "manager" ? { restaurantId: "r", email: "manager@example.com" } : null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async (event: unknown) => { state.log(event); } }));
vi.mock("@/lib/terminal-server", () => ({ readTerminal: async (_r: string, _tz: string, _now: Date, currency: string) => {
  state.priced(currency); return { days: [{ day: "2026-10-20", count: 1, expected: currency === "MXN" ? 1000 : 100 }] };
} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
  if (name === "delete_terminal_deposit_v1") {
    const before = state.rows.length;
    state.rows = state.rows.filter(r => !(r.restaurant_id === args.p_restaurant && r.sales_day === args.p_day && r.currency === args.p_currency));
    return { data: state.rows.length < before, error: null };
  }
  state.priced(args.p_currency);
  if (state.rows.some(r => r.restaurant_id === args.p_restaurant && r.sales_day === args.p_day && r.currency === args.p_currency)) return { data: { error: "marked" }, error: null };
  const expected = args.p_currency === "MXN" ? 1000 : 100;
  state.rows.push({ id: String(state.rows.length), restaurant_id: String(args.p_restaurant), sales_day: String(args.p_day), currency: String(args.p_currency), expected, received: Number(args.p_received) });
  return { data: { expected }, error: null };
}, from: (table: string) => {
  const filters: Record<string, unknown> = {};
  let action = "read";
  let patch: Partial<Deposit> = {};
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = q.is = (key: string, value: unknown) => { filters[key] = value; return q; };
  q.insert = (row: Deposit) => { action = "insert"; patch = row; return q; };
  q.update = (row: Partial<Deposit>) => { action = "update"; patch = row; return q; };
  q.delete = () => { action = "delete"; return q; };
  const result = () => {
    if (table === "restaurants") return { data: { timezone: "UTC" }, error: null };
    if (action === "insert") {
      if (state.rows.some(r => r.restaurant_id === patch.restaurant_id && r.sales_day === patch.sales_day && r.currency === patch.currency)) return { data: null, error: { code: "23505" } };
      state.rows.push({ ...patch, id: String(state.rows.length) } as Deposit);
      return { data: null, error: null };
    }
    const matched = state.rows.filter(r => Object.entries(filters).every(([key, value]) => r[key as keyof Deposit] === value));
    if (action === "update") matched.forEach(r => Object.assign(r, patch));
    if (action === "delete") state.rows = state.rows.filter(r => !matched.includes(r));
    return { data: matched, error: null };
  };
  q.single = async () => result();
  q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return q;
} }) }));
const deposits = await import("@/app/api/terminal/deposits/route");
const verify = await import("@/app/api/terminal/deposits/verify/route");
const request = (data: unknown) => new NextRequest("http://localhost/api/terminal/deposits", { method: "POST", body: JSON.stringify(data) });
beforeEach(() => { state.rows = []; state.role = "manager"; vi.clearAllMocks(); });
it("records separate deposits for each currency and deletes only the requested currency", async () => {
  for (const currency of ["MXN", "USD"]) expect((await deposits.POST(request({ day: "2026-10-20", received: 100, currency }))).status).toBe(200);
  expect(state.priced.mock.calls.map(c => c[0])).toEqual(["MXN", "USD"]);
  expect(state.rows.map(r => [r.currency, r.expected])).toEqual([["MXN", 1000], ["USD", 100]]);
  expect((await deposits.DELETE(request({ day: "2026-10-20", currency: "USD" }))).status).toBe(200);
  expect(state.rows.map(r => r.currency)).toEqual(["MXN"]);
  expect((await deposits.POST(request({ day: "2026-10-20", received: 100 }))).status).toBe(400);
});
it("only attributes an unverified deposit after a manager confirms its bank receipt, with an audit reason", async () => {
  state.rows = [{ id: "old", restaurant_id: "r", sales_day: "2026-10-20", currency: null, expected: 1000, received: 1000 }];
  const body = { id: "old", currency: "MXN", confirmed: true, reason: "Checked bank receipt" };
  expect((await verify.POST(request({ ...body, confirmed: false }))).status).toBe(400);
  state.role = "cashier";
  expect((await verify.POST(request(body))).status).toBe(403);
  state.role = "manager";
  expect((await verify.POST(request(body))).status).toBe(200);
  expect(state.rows[0]).toMatchObject({ currency: "MXN", expected: 1000, received: 1000 });
  expect(state.log).toHaveBeenCalledWith(expect.objectContaining({ actor: "manager@example.com", detail: expect.stringContaining("currency=MXN") }));
  expect((await verify.POST(request({ ...body, currency: "USD" }))).status).toBe(404);
});
it("cannot attribute or delete another restaurant's deposit", async () => {
  state.rows = [{ id: "other", restaurant_id: "other-r", sales_day: "2026-10-20", currency: null, expected: 1000, received: 1000 }];
  expect((await verify.POST(request({ id: "other", currency: "MXN", confirmed: true, reason: "Checked bank receipt" }))).status).toBe(404);
  expect((await deposits.DELETE(request({ day: "2026-10-20", currency: "MXN" }))).status).toBe(404);
  expect(state.rows[0].currency).toBeNull(); expect(state.log).not.toHaveBeenCalled();
});
