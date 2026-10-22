import { vi } from "vitest";

export const at = (day: number, hour = 12) => `2026-10-${day}T${hour}:00:00Z`;
export function fixture() {
  const payment = { id: "cash", restaurant_id: "r", currency: "MXN", amount: 100, tip: 0,
    method: "cash", actor_email: "cashier", created_at: at(23), recorded_at: at(23) };
  const card = { ...payment, id: "card", method: "card", stripe_payment_intent: null };
  return {
    restaurants: [{ id: "r", timezone: "UTC", terminal_fee_pct: 3.5 }],
    cash_shifts: [{ id: "shift", restaurant_id: "r", currency: "MXN", opened_at: at(23, 10),
      closed_at: at(23, 18), opening_amount: 200, expected_cash: 280, counted_cash: 270, difference: -10 }],
    cash_movements: [{ id: "withdrawal", restaurant_id: "r", currency: "MXN", shift_id: "shift",
      kind: "withdrawal", amount: 20, created_at: at(23, 15) }],
    payments: [payment, card], orders: [], user_logs: [], refund_operations: [],
    payment_allocations: [], refund_allocations: [], order_adjustments: [],
    terminal_deposits: [{ id: "deposit", restaurant_id: "r", currency: "MXN", sales_day: "2026-10-23",
      created_at: at(23, 18), snapshot_at: at(23, 18), expected: 96.5, fee_pct: 3.5,
      payment_ids: ["card"], return_ids: [] }],
    ledger: [{ ...card, payment_id: "card", voided_at: null, returned_at: null }],
  };
}

export type Rows = Record<string, object[]>;
/** Only reads exist on this fake. A second page error must invalidate the check. */
export function database(rows: Rows, fail = "", failOffset = 0) {
  const reads: string[] = [];
  const query = (table: string) => ({
    select() { return this; }, order() { return this; },
    async range(start: number) {
      reads.push(`${table}:${start}`);
      if (table === fail && start === failOffset) return { data: null, error: { message: "read refused" } };
      return { data: (rows[table] ?? []).slice(start, start + 1), error: null };
    },
  });
  const db = { from: query, rpc: () => query("ledger") };
  const all = async (build: () => ReturnType<typeof query>) => {
    const data: object[] = [];
    for (;;) {
      const page = await build().order().range(data.length);
      if (page.error) return page;
      if (!page.data?.length) return { data, error: null };
      data.push(...page.data);
    }
  };
  return { db, all, reads, ok: vi.fn(), bad: vi.fn() };
}
