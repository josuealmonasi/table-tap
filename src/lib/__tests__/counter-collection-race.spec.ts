import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({ total: 100, currency: "MXN", discount: false, changeCurrency: false,
  receipts: [] as number[], paid: false, args: {} as Record<string, unknown>, logs: [] as unknown[] }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: () => {} }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => ({ restaurantId: "r", email: "cashier" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async (event: unknown) => { s.logs.push(event); } }));
vi.mock("@/lib/table-session", () => ({ closeSessionsFor: async () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => {
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "is", "neq"]) q[op] = () => q;
    q.then = (done: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: "order", total: s.total, currency: s.currency }], error: null }).then(done);
    return q;
  },
  rpc: async (_name: string, args: Record<string, unknown>) => {
    // A manager commits after the route's read, before settlement takes its lock.
    if (s.discount) s.total = 80;
    if (s.changeCurrency) s.currency = "USD";
    s.args = args;
    if (("p_expected" in args && args.p_expected !== s.total) || ("p_currency" in args && args.p_currency !== s.currency)) {
      return { data: null, error: { message: "not_owed" } };
    }
    s.receipts.push(s.total); s.paid = true;
    return { data: 1, error: null };
  },
}) }));
import { POST } from "@/app/api/table-payment/route";
const post = () => POST(new NextRequest("https://test/api/table-payment", { method: "POST",
  body: JSON.stringify({ orderId: "order", settlement: "cash", expected: 100, currency: "MXN" }) }));
beforeEach(() => Object.assign(s, { total: 100, currency: "MXN", discount: false, changeCurrency: false, receipts: [], paid: false, args: {}, logs: [] }));
it.each(["discount", "changeCurrency"] as const)("N1: refuses a %s committed between quote and money lock", async change => {
  s[change] = true;
  expect((await post()).status).toBe(409);
  expect(s.receipts).toEqual([]); expect(s.paid).toBe(false); expect(s.logs).toEqual([]);
});
it("N1: sends the reviewed amount and currency to the locked writer", async () => {
  expect((await post()).status).toBe(200);
  expect(s.args).toMatchObject({ p_expected: 100, p_currency: "MXN", p_skip_ticket_email: false });
  expect(s.receipts).toEqual([100]);
});
