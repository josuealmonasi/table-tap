import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], deposits: [] as Record<string, unknown>[], failPage: false }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => {
  const query = (table: string) => {
    let start = ""; let end = ""; let offset = 0; let cancelled = false;
    const q: Record<string, unknown> = {};
    for (const key of ["select", "eq", "is", "order", "overrideTypes"]) q[key] = () => q;
    q.eq = (key: string) => { if (key === "orders.status") cancelled = true; return q; };
    q.gte = (key: string, value: string) => { if (key === "created_at") start = value; return q; };
    q.lt = (key: string, value: string) => { if (key === "created_at") end = value; return q; };
    q.range = (from: number) => { offset = from; return q; };
    const result = () => table === "restaurants" ? { data: { currency: "MXN", terminal_fee_pct: 0, terminal_settle_days: 1 }, error: null }
      : { data: (table === "payments" || table === "ledger" ? state.rows.filter(p => !cancelled && (!start || String(p.created_at) >= start) && (!end || String(p.created_at) < end)) : table === "terminal_deposits" ? state.deposits : []).slice(offset, offset + 1), error: state.failPage && offset ? { message: "read failed" } : null };
    q.single = async () => result();
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return q;
  };
  return { from: query, rpc: () => query("ledger") };
} }));
const { readTerminal } = await import("@/lib/terminal-server");
const payment = (id: string, created_at: string, recorded_at = created_at) => ({ id, amount: 100, tip: 0, created_at, recorded_at, orders: null, returned_at: null });
beforeEach(() => { state.rows = []; state.deposits = []; state.failPage = false; });
it("I6 reads MX$200 for the whole oldest Mexico City day at 15:00", async () => {
  state.rows = [payment("a", "2026-10-06T15:00:00Z"), payment("b", "2026-10-06T23:00:00Z")];
  const view = await readTerminal("r", "America/Mexico_City", new Date("2026-10-20T21:00:00Z"));
  expect(view.days.find(d => d.day === "2026-10-06")).toMatchObject({ expected: 200, count: 2 });
});
it("I6 reads all of a sales day recovered twenty days late, across pages", async () => {
  state.rows = [payment("a", "2026-09-30T15:00:00Z"), payment("b", "2026-09-30T23:00:00Z", "2026-10-20T18:00:00Z")];
  const view = await readTerminal("r", "America/Mexico_City", new Date("2026-10-20T21:00:00Z"));
  expect(view.days.find(d => d.day === "2026-09-30")).toMatchObject({ expected: 200, count: 2 });
  expect(view.payments["2026-09-30"]).toHaveLength(2);
});
it("refuses an incomplete day when a later page fails", async () => {
  state.rows = [payment("a", "2026-10-20T15:00:00Z"), payment("b", "2026-10-20T23:00:00Z")]; state.failPage = true;
  await expect(readTerminal("r", "UTC")).rejects.toThrow("read failed");
});

it("I6 keeps an older marked day visible when a recovered receipt is outside its manifest", async () => {
  state.rows = [payment("a", "2026-09-30T15:00:00Z"), payment("b", "2026-09-30T23:00:00Z", "2026-10-20T18:00:00Z")];
  state.deposits = [{ sales_day: "2026-09-30", expected: 100, received: 100, created_at: "2026-10-01T18:00:00Z", payment_ids: ["a"], return_ids: [] }];
  const view = await readTerminal("r", "America/Mexico_City", new Date("2026-10-20T21:00:00Z"));
  expect(view.days[0]).toMatchObject({ expected: 100, late: 100, takings: 200, status: "short" });
});
