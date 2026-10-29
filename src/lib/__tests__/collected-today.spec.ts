import { beforeEach, expect, it, vi } from "vitest";
import { logDetail } from "@/lib/log-detail";

// Audit N finding 4: the orders board's "today" read paid orders created today,
// so money that arrived any other way read as MX$0. It now reads the ledger.
const state = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, failed: "" }));
function query(table: string) {
  const filters: ((r: Record<string, unknown>) => boolean)[] = [];
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
    is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q; },
    gte: (k: string, v: string) => { filters.push(r => String(r[k]) >= v); return q; },
    lte: (k: string, v: string) => { filters.push(r => String(r[k]) <= v); return q; },
    order: () => q,
    range: async (a: number, b: number) => state.failed === table
      ? { data: null, error: { message: "read failed" } }
      : { data: (state.rows[table] ?? []).filter(r => filters.every(f => f(r))).slice(a, b + 1), error: null },
  };
  return q;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: query, rpc: (_name: string, args: { p_restaurant: string; p_currency: string | null }) =>
  query("refund_operations").eq("restaurant_id", args.p_restaurant).eq("currency", args.p_currency).eq("status", "succeeded") }) }));
const { collectedToday } = await import("@/lib/collected-today");

const midnight = new Date("2026-10-27T06:00:00.000Z");
const today = "2026-10-27T18:00:00.000Z";
const yesterday = "2026-10-27T05:59:59.000Z";
const at = (currency: string, extra: Record<string, unknown>) =>
  ({ restaurant_id: "r", currency, created_at: today, ...extra });
const refundLog = (currency: string, fields: Record<string, string>) =>
  ({ restaurant_id: "r", created_at: today, entity: "order", action: "refunded", detail: logDetail({ ...fields, currency }) });

beforeEach(() => { state.rows = {}; state.failed = ""; });

it.each(["MXN", "USD"])("%s: counts every way money arrives, once each", async currency => {
  state.rows.payments = [
    at(currency, { actor_email: "cajero@x", amount: 50, method: "cash" }),  // half of a MX$100 order
    at(currency, { actor_email: "cajero@x", amount: 40, method: "card" }),  // one share of a split
    at(currency, { actor_email: "cajero@x", amount: 60, method: "cash" }),  // the other share
    at(currency, { actor_email: "mesero@x", amount: 100, method: "cash" }), // yesterday's account, settled today
    at(currency, { actor_email: null, amount: 110, method: "card" }),       // a diner's card online, tip included
    at(currency, { actor_email: "cajero@x", amount: 100, method: "cash", created_at: yesterday }),
    at(currency === "MXN" ? "USD" : "MXN", { actor_email: "cajero@x", amount: 900, method: "cash" }),
    { ...at(currency, { actor_email: "cajero@x", amount: 900, method: "cash" }), restaurant_id: "other" },
  ];
  expect(await collectedToday("r", currency, midnight)).toBe(360);
});

it.each(["MXN", "USD"])("%s: takes off what went back, once, and not a duplicate charge's return", async currency => {
  state.rows.payments = [at(currency, { actor_email: "cajero@x", amount: 200, method: "cash" }),
    at(currency, { actor_email: null, amount: 100, method: "card" })];
  state.rows.user_logs = [
    refundLog(currency, { amount: "30", method: "cash", collector: "cajero@x" }),
    refundLog(currency, { amount: "20", method: "card" }),  // a diner's card, out of no drawer
    { ...refundLog(currency, { amount: "500", why: "paid_twice" }), entity: "bill" }, // never entered takings
    { ...refundLog(currency, { amount: "500", method: "cash", collector: "cajero@x" }), created_at: yesterday },
  ];
  state.rows.refund_operations = [
    at(currency, { id: "return", amount_cents: 1000, succeeded_at: today, status: "succeeded", source: "cash", amount: 10, payout_actor: "cajero@x", completed_at: today, historical_log_id: null }),
    at(currency, { status: "pending", source: "cash", amount: 500, payout_actor: "cajero@x", completed_at: today, historical_log_id: null }),
    // Already counted through its original log line: never twice.
    at(currency, { status: "succeeded", source: "cash", amount: 500, payout_actor: "cajero@x", completed_at: today, historical_log_id: "l" }),
  ];
  expect(await collectedToday("r", currency, midnight)).toBe(240);
});

it.each(["payments", "user_logs", "refund_operations"])("a failed read of %s throws rather than show a wrong number", async table => {
  state.failed = table;
  await expect(collectedToday("r", "MXN", midnight)).rejects.toThrow();
});
