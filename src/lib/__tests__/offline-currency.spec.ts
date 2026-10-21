import { expect, it, vi } from "vitest";
import type { CashShift } from "@/lib/cash-shift";

vi.mock("@/lib/platform-fee", () => ({ feesKeptSince: async () => 0 }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { const from = (table: string) => {
  let currency: unknown;
  let method: unknown;
  let offset = 0;
  let earlier = false;
  let withoutHistoricalReturns = false;
  const q: Record<string, unknown> = {};
  q.eq = (key: string, value: unknown) => { if (key === "currency") currency = value; if (key === "method") method = value; return q; };
  for (const key of ["select", "is", "gte", "lte", "lt", "neq", "order", "overrideTypes"]) q[key] = () => q;
  q.is = (key: string, value: unknown) => { if (key === "historical_log_id" && value === null) withoutHistoricalReturns = true; return q; };
  q.lt = () => { earlier = true; return q; };
  q.range = (from: number) => { offset = from; return q; };
  const result = () => {
    if (table === "restaurants") return { data: { currency: "MXN", tax_pct: 0, terminal_fee_pct: 0, terminal_settle_days: 0 }, error: null };
    const currencies = ["MXN", "USD"].filter(c => !currency || c === currency);
    let data: unknown[] = [];
    if (table === "payments" && !earlier) data = currencies.flatMap(c => ["cash", "card"].filter(m => !method || m === method).map(m => ({
      id: `${c}-${m}`, currency: c, method: m, amount: c === "MXN" ? 100 : 200, tip: 0, actor_email: "cashier@example.com",
      created_at: "2026-10-20T12:00:00Z", orders: null, stripe_payment_intent: null,
    })));
    if (table === "orders") data = currencies.map(c => ({ items: [{ itemId: "dish", name: "Dish", price: c === "MXN" ? 100 : 200, qty: 1 }], subtotal: c === "MXN" ? 100 : 200, tax_pct: 0 }));
    if (table === "refund_operations") data = currencies.map(c => ({ source: "cash", amount: c === "MXN" ? 10 : 50, payout_actor: "cashier@example.com", completed_at: "2026-10-20T13:00:00Z", tip: 0 }));
    // An imported return already counted by its old log must not leave the
    // drawer twice, even when its currency matches the current restaurant.
    if (table === "refund_operations" && !withoutHistoricalReturns && (!currency || currency === "MXN")) {
      data.push({ source: "cash", amount: 70, tip: 0, payout_actor: "cashier@example.com", historical_log_id: "old-return",
        completed_at: "2026-10-20T13:00:00Z" });
    }
    return { data: data.slice(offset), error: null };
  };
  q.single = async () => result();
  q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return q;
}; return { from, rpc: (_name: string, args: { p_currency: string }) => { const q = from("payments"); const eq = q.eq as (key: string, value: string) => unknown; eq("currency", args.p_currency); eq("method", "card"); return q; } }; } }));

const { shiftSumOf } = await import("@/lib/cash-shift-server");
const { readCosts } = await import("@/lib/costs/server");
const { readTerminal } = await import("@/lib/terminal-server");

it("keeps original-currency receipts and returns out of a current-currency drawer count", async () => {
  const sum = await shiftSumOf("r", { id: "shift", opening_amount: 20, opened_at: "2026-10-20T00:00:00Z", closed_at: null } as CashShift);
  expect(sum).toMatchObject({ cashSales: 90, expected: 110 });
});
it("does not add foreign-currency receipts to current menu margins or fee totals", async () => {
  const costs = await readCosts("r", new Date("2026-10-20T18:00:00Z"));
  expect(costs.period.uncosted).toBe(100);
  expect(costs.fees.takings).toBe(200);
});
it("does not relabel foreign-currency terminal receipts as current-currency deposits", async () => {
  const terminal = await readTerminal("r", "UTC", new Date("2026-10-20T18:00:00Z"));
  expect(Object.values(terminal.payments).flat().map(p => p.amount)).toEqual([100]);
});

it("excludes imported handbacks while filtering typed returns to their collected currency", async () => {
  const { returnedAdjustments } = await import("@/lib/refunds/adjustments");
  expect(await returnedAdjustments("r", "2026-10-20T00:00:00Z", undefined, "MXN"))
    .toEqual([{ action: "refunded", detail: expect.stringContaining("amount=10.00") }]);
});
