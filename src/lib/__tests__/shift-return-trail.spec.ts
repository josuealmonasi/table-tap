import { describe, expect, it, vi } from "vitest";
import type { CashShift } from "@/lib/cash-shift";
const reads = vi.hoisted(() => [] as { table: string; filters: unknown[][] }[]);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    const q = { select: () => q, eq: () => q, in: () => q, gte: () => q, lte: () => q, order: () => q,
      range: async () => ({ error: null, data: [] }) };
    reads.push({ table, filters: [] }); return q;
  },
  rpc: (name: string, args: Record<string, unknown>) => {
    const filters: unknown[][] = [["restaurant_id", args.p_restaurant]]; reads.push({ table: name, filters });
    const q = { gte: (...v: unknown[]) => { filters.push(v); return q; },
      lte: (...v: unknown[]) => { filters.push(v); return q; }, is: (...v: unknown[]) => { filters.push(v); return q; }, order: () => q,
      range: async (from: number) => ({ error: null, data: from > 0 ? [] : [{ id: "event", amount_cents: 10000, source: "cash",
        payout_actor: "cashier", confirmed_by: "manager", succeeded_at: "2026-10-20T14:00:00Z", order_id: "12345678-order" }] }) };
    return q;
  },
}) }));
import { shiftTrail } from "@/lib/cash-shift-server";
describe("completed return in a cash shift", () => {
  it("explains typed cash leaving the drawer once with order, payout actor and completion time", async () => {
    const trail = await shiftTrail("tenant", { opened_at: "2026-10-20T12:00:00Z", closed_at: "2026-10-20T16:00:00Z" } as CashShift);
    expect(trail).toEqual([{ entity: "order", action: "refunded", actor_email: "cashier", created_at: "2026-10-20T14:00:00Z",
      detail: expect.stringMatching(/amount=100.00.*order=12345678/) }]);
    expect(reads.find(r => r.table === "order_return_events_v1")?.filters).toEqual(expect.arrayContaining([
      ["restaurant_id", "tenant"], ["historical_log_id", null],
      ["succeeded_at", "2026-10-20T12:00:00Z"], ["succeeded_at", "2026-10-20T16:00:00Z"],
    ]));
  });
});
