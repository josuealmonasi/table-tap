import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";

// Audit of #648, server F1: a table its parts already paid closes at MX$0
// through closeBill, not through the reviewed collection. "Don't send ticket"
// on that close must reach the same lock that marks the orders paid, or the
// queue_ticket_email trigger emails the comped table anyway.
const s = vi.hoisted(() => ({ rpc: vi.fn(), closeSessions: vi.fn(), record: vi.fn(), rows: [{ id: "comped", session_id: "sitting" }] }));
vi.mock("@/lib/checkout-page-rpc", () => ({ checkoutPageRpc: s.rpc }));
vi.mock("@/lib/table-session", () => ({ closeSessionsFor: s.closeSessions, openSession: vi.fn() }));
vi.mock("@/lib/reviewed-collection", () => ({ recordReviewed: s.record }));
vi.mock("@/lib/activity-log", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "neq", "limit", "update"]) q[m] = () => q;
    q.then = (done: (v: unknown) => void) => done({ data: s.rows, error: null });
    return q;
  },
}) }));
const { settleReviewedTable } = await import("@/lib/settle-reviewed-table");
const actor = { restaurantId: "r", email: "cashier" } as Parameters<typeof settleReviewedTable>[0];
beforeEach(() => {
  vi.clearAllMocks();
  s.rpc.mockResolvedValue({ error: null });
});

it("a comped table closed with \"don't send\" settles through the overload that marks the skip", async () => {
  const res = await settleReviewedTable(actor, "t", { expected: 0, currency: "MXN", ref: "c-1", skipTicketEmail: true }, "cash");
  expect(res.status).toBe(200);
  expect(s.record).not.toHaveBeenCalled();
  expect(s.rpc).toHaveBeenCalledWith("settle_orders_v2", {
    p_restaurant: "r", p_orders: ["comped"], p_method: "cash", p_actor: "cashier", p_sittings: [], p_skip_ticket_email: true,
  });
});

it("a MX$0 close that sends the ticket says so too, rather than inheriting an older mark", async () => {
  await settleReviewedTable(actor, "t", { expected: 0, currency: "MXN", ref: "c-1" }, "card");
  expect(s.rpc.mock.calls[0][1]).toMatchObject({ p_skip_ticket_email: false });
});

it("a close after a written collection keeps the five-argument call: that collection already marked its choice", async () => {
  s.record.mockResolvedValue({ wrote: true, landed: 100, tip: 0 });
  await settleReviewedTable(actor, "t", { expected: 100, currency: "MXN", ref: "c-1", skipTicketEmail: true }, "cash");
  expect(s.rpc.mock.calls[0][1]).not.toHaveProperty("p_skip_ticket_email");
});

it("SQL: the six-argument settle marks under the money lock, rows in id order, only where it changes, then settles", () => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const start = schema.indexOf("p_restaurant uuid, p_orders uuid[], p_method text, p_actor text, p_sittings jsonb, p_skip_ticket_email boolean");
  expect(start).toBeGreaterThan(-1);
  const fn = schema.slice(start, schema.indexOf("$$;", start));
  const lock = fn.indexOf("perform public.lock_restaurant_money(p_restaurant)");
  const rowsLocked = fn.indexOf("order by id for update");
  const mark = fn.indexOf("update orders set ticket_email_skip = p_skip_ticket_email");
  const settle = fn.indexOf("return public.settle_orders_v2(p_restaurant, p_orders, p_method, p_actor, p_sittings);");
  expect(lock).toBeGreaterThan(-1); expect(rowsLocked).toBeGreaterThan(lock);
  expect(mark).toBeGreaterThan(rowsLocked); expect(settle).toBeGreaterThan(mark);
  expect(fn).toContain("ticket_email_skip is distinct from p_skip_ticket_email");
  expect(fn.split("returns")[0]).not.toContain("default");
  // The trigger that queues the ticket reads the mark the overload just wrote.
  expect(schema).toMatch(/create or replace function public\.queue_ticket_email\(\)[\s\S]*?or new\.ticket_email_skip/);
  expect(schema).toContain("grant execute on function public.settle_orders_v2(uuid, uuid[], text, text, jsonb, boolean) to service_role;");
  expect(readFileSync("supabase/drop.sql", "utf8")).toContain("drop function if exists public.settle_orders_v2(uuid, uuid[], text, text, jsonb, boolean);");
});

// Model the SQL overload at the RPC boundary; the SQL pin below checks that
// the real writer makes the same decision while it holds the money lock.
it.each([
  { covered: true, saved: true, choice: false, want: true },
  { covered: true, saved: false, choice: true, want: false },
  { covered: false, saved: true, choice: false, want: false },
  { covered: false, saved: false, choice: true, want: true },
])("a zero close keeps a paid collection's choice, and uses a new choice for a free bill: $covered $saved $choice", async ({ covered, saved, choice, want }) => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const start = schema.indexOf("p_restaurant uuid, p_orders uuid[], p_method text, p_actor text, p_sittings jsonb, p_skip_ticket_email boolean");
  const fn = schema.slice(start, schema.indexOf("$$;", start));
  let mark = saved;
  s.rpc.mockImplementation(async (_name, args) => {
    const protectsCoverage = /if not exists\s*\(\s*select 1 from payment_allocations a[\s\S]*?a\.restaurant_id = p_restaurant[\s\S]*?a\.order_id = any\(p_orders\)/.test(fn);
    if (!covered || !protectsCoverage) mark = args.p_skip_ticket_email;
    return { error: null };
  });
  const res = await settleReviewedTable(actor, "t", { expected: 0, currency: "MXN", ref: "retry", skipTicketEmail: choice }, "cash");
  expect(res.status).toBe(200);
  expect(mark).toBe(want);
});

it("SQL: zero close checks recorded coverage under the money lock before changing any ticket choice", () => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const start = schema.indexOf("p_restaurant uuid, p_orders uuid[], p_method text, p_actor text, p_sittings jsonb, p_skip_ticket_email boolean");
  const fn = schema.slice(start, schema.indexOf("$$;", start));
  const lock = fn.indexOf("perform public.lock_restaurant_money(p_restaurant)");
  const backfill = fn.indexOf("perform public.backfill_payment_allocations(p_restaurant)");
  const rowsLocked = fn.indexOf("order by id for update");
  const coverage = fn.indexOf("if not exists (select 1 from payment_allocations a");
  const mark = fn.indexOf("update orders set ticket_email_skip = p_skip_ticket_email");
  const settle = fn.indexOf("return public.settle_orders_v2(p_restaurant, p_orders, p_method, p_actor, p_sittings);");
  expect(backfill).toBeGreaterThan(lock);
  expect(rowsLocked).toBeGreaterThan(backfill);
  expect(coverage).toBeGreaterThan(rowsLocked);
  expect(mark).toBeGreaterThan(coverage);
  expect(fn.slice(coverage, mark)).toMatch(/a\.restaurant_id = p_restaurant[\s\S]*a\.order_id = any\(p_orders\)/);
  expect(fn.slice(mark, settle)).toContain("end if;");
});
