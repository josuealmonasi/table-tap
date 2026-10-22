import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { const from = (table: string) => {
  const filters: Record<string, unknown> = {};
  let earlier = false;
  let offset = 0;
  const q: Record<string, unknown> = {};
  for (const key of ["select", "is", "gte", "order", "range", "overrideTypes"]) q[key] = () => q;
  q.range = (from: number) => { offset = from; return q; };
  q.is = (key: string, value: unknown) => { if (key === "currency") filters[key] = value; return q; };
  q.eq = (key: string, value: unknown) => { filters[key] = value; return q; };
  q.lt = () => { earlier = true; return q; };
  const result = () => {
    if (table === "restaurants") return { data: { currency: "USD", terminal_fee_pct: 0, terminal_settle_days: 0 }, error: null };
    const rows = table === "terminal_deposits" ? [{ sales_day: "2026-10-20", currency: "MXN", expected: 1000, received: 1000, created_at: "2026-10-20T10:00:00Z" }, { id: "legacy", sales_day: "2026-10-19", currency: null, expected: 500, received: 500, created_at: "2026-10-19T10:00:00Z" }]
      : table === "payments" && !earlier ? [{ id: "usd", currency: "USD", amount: 100, tip: 0, created_at: "2026-10-20T12:00:00Z", recorded_at: "2026-10-20T13:00:00Z", orders: null }] : [];
    return { data: rows.filter(r => !("currency" in r) || !("currency" in filters) || r.currency === filters.currency).slice(offset), error: null };
  };
  q.single = async () => result();
  q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return q;
}; return { from, rpc: (_name: string, args: { p_currency: string }) => { const q = from("payments"); (q.eq as (key: string, value: string) => unknown)("currency", args.p_currency); return q; } }; } }));
const { readTerminal } = await import("@/lib/terminal-server");
it("never combines a peso deposit with a later dollar receipt on the same day", async () => {
  const view = await readTerminal("r", "UTC", new Date("2026-10-20T18:00:00Z"));
  expect(view.days[0]).toMatchObject({ expected: 100, late: 0, deposit: null });
});

it("keeps an existing peso deposit visible in pesos after settings switch to dollars", async () => {
  const view = await readTerminal("r", "UTC", new Date("2026-10-20T18:00:00Z"), "MXN");
  expect(view.days[0]).toMatchObject({ expected: 1000, late: 0, deposit: { currency: "MXN", received: 1000 }, status: "received" });
});
it("lists currencies separately and keeps older unverified deposits outside their arithmetic", async () => {
  const { readTerminalReport } = await import("@/lib/terminal-report");
  const report = await readTerminalReport("r", "UTC", "USD");
  expect(report.currencies.map(c => c.currency)).toEqual(["MXN", "USD"]);
  expect(report.unverified).toMatchObject([{ id: "legacy", currency: null, expected: 500, received: 500 }]);
  expect(report.currencies.flatMap(c => c.view.days).some(d => d.expected === 500)).toBe(false);
});
