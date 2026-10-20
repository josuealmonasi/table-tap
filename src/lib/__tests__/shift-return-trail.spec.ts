import { describe, expect, it, vi } from "vitest";
import type { CashShift } from "@/lib/cash-shift";
const reads = vi.hoisted(() => [] as { table: string; filters: unknown[][] }[]);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const filters: unknown[][] = []; reads.push({ table, filters });
  const q = { select: () => q, eq: (...v: unknown[]) => { filters.push(v); return q; },
    in: () => q, gte: (...v: unknown[]) => { filters.push(v); return q; },
    lte: (...v: unknown[]) => { filters.push(v); return q; }, is: (...v: unknown[]) => { filters.push(v); return q; }, order: () => q,
    range: (from: number) => ({ overrideTypes: async () => ({ error: null, data: table === "user_logs" || from > 0 ? [] : [{ amount: 100, source: "cash",
      payout_actor: "cashier", confirmed_by: "manager", completed_at: "2026-10-20T14:00:00Z",
      order_adjustments: { order_id: "12345678-order" } }] }) }) };
  return q;
} }) }));
import { shiftTrail } from "@/lib/cash-shift-server";
describe("completed return in a cash shift", () => {
  it("explains typed cash leaving the drawer once with order, payout actor and completion time", async () => {
    const trail = await shiftTrail("tenant", { opened_at: "2026-10-20T12:00:00Z", closed_at: "2026-10-20T16:00:00Z" } as CashShift);
    expect(trail).toEqual([{ entity: "order", action: "refunded", actor_email: "cashier", created_at: "2026-10-20T14:00:00Z",
      detail: expect.stringMatching(/amount=100.00.*order=12345678/) }]);
    expect(reads.find(r => r.table === "refund_operations")?.filters).toEqual(expect.arrayContaining([
      ["restaurant_id", "tenant"], ["status", "succeeded"], ["historical_log_id", null],
      ["completed_at", "2026-10-20T12:00:00Z"], ["completed_at", "2026-10-20T16:00:00Z"],
    ]));
  });
});
