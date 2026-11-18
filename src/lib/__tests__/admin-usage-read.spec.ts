import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, failed: "" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: query,
  rpc: (name: string, args: { p_restaurant: string }) => name === "order_return_events_v1"
    ? query("events").eq("restaurant_id", args.p_restaurant)
    : Promise.resolve({ data: "2026-11-10T00:00:00Z", error: state.failed === name ? { message: "failed" } : null }),
}) }));
function query(table: string) {
  const filters: ((row: Record<string, unknown>) => boolean)[] = [];
  let offset = 0, limit = 2, descending = false;
  const result = () => {
    const rows = (state.rows[table] ?? []).filter(row => filters.every(f => f(row)));
    const sorted = descending ? [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) : rows;
    return { data: sorted.slice(offset, offset + limit), count: rows.length, error: state.failed === table ? { message: "failed" } : null };
  };
  const q = {
    select: () => q,
    overrideTypes: () => q,
    eq: (k: string, v: unknown) => { filters.push(row => row[k] === v); return q; },
    neq: (k: string, v: unknown) => { filters.push(row => row[k] !== v); return q; },
    in: (k: string, values: unknown[]) => { filters.push(row => values.includes(row[k])); return q; },
    gte: (k: string, v: string) => { filters.push(row => String(row[k]) >= v); return q; },
    lt: (k: string, v: string) => { filters.push(row => String(row[k]) < v); return q; },
    order: (k: string, options?: { ascending: boolean }) => { if (k === "created_at" && options?.ascending === false) descending = true; return q; },
    limit: (n: number) => { limit = n; return q; },
    range: (a: number) => { offset = a; return q; },
    maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  };
  return q;
}
const { readAdminUsage } = await import("@/lib/admin-usage-read");
const at = "2026-11-05T12:00:00.000Z";
beforeEach(() => {
  state.failed = "";
  state.rows = {
    restaurants: [{ id: "r" }], staff: [{ id: "s", restaurant_id: "r" }],
    orders: [{ id: "o", restaurant_id: "r", paid: true, status: "completed", currency: "MXN", total: 80, tip: 10, service_fee: 0, items: [], created_at: at }],
    payments: [{ id: "p", restaurant_id: "r", currency: "MXN", amount: 100, method: "cash", created_at: at }],
    platform_fees: [{ id: "f", restaurant_id: "r", status: "taken", cents: 400, refunded_cents: 100, stripe_payment_intent: "pi", settled_at: at },
      { id: "unknown", restaurant_id: "r", status: "taken", cents: 100, refunded_cents: 0, stripe_payment_intent: "missing", settled_at: at }],
    diner_checkouts: [{ restaurant_id: "r", stripe_payment_intent: "pi", currency: "USD" },
      { restaurant_id: "other", stripe_payment_intent: "missing", currency: "MXN" }],
    order_adjustments: [{ id: "a", restaurant_id: "r", kind: "return", order_id: "o", currency: "MXN", previous_total: 100, resulting_total: 80, previous_tip: 12, resulting_tip: 10, previous_service_fee: 0, resulting_service_fee: 0 }],
    refund_operations: [{ id: "op", restaurant_id: "r", amount: 20, tip: 2, currency: "MXN", order_adjustments: { order_id: "o", kind: "return" } }],
    events: [{ id: "e", restaurant_id: "r", operation_id: "op", order_id: "o", currency: "MXN", amount_cents: 2000, succeeded_at: at, kind: "return" }],
  };
});
it("reads one restaurant and keeps fee currencies and return tips separate", async () => {
  const result = await readAdminUsage("r", new Date("2026-11-17T12:00:00.000Z"));
  expect(result?.lastActivity).toBe("2026-11-10T00:00:00Z");
  expect(result?.staff).toBe(1);
  expect(result?.month.sales).toEqual([{ currency: "MXN", amount: 70 }]);
  expect(result?.month.tips).toEqual([{ currency: "MXN", amount: 10 }]);
  expect(result?.month.fees).toEqual([{ currency: "USD", amount: 3 }, { currency: null, amount: 1 }]);
});
it.each(["orders", "payments", "platform_fees", "events", "diner_checkouts", "refund_operations", "admin_restaurant_last_sign_in_v1"])("refuses an incomplete %s read", async table => {
  state.failed = table;
  await expect(readAdminUsage("r", new Date("2026-11-17T12:00:00.000Z"))).rejects.toThrow();
});
