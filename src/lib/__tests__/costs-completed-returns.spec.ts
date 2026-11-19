import { beforeEach, expect, it, vi } from "vitest";
import { returnFixture } from "./returns-contract-fixtures";
import { eventQuery } from "./return-events-fixture";
import { computeAnalytics } from "@/lib/analytics";
import { withReturnComponents } from "@/lib/return-components";
import { saleReturnSummary } from "@/lib/refunds/reporting";

const db = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
vi.mock("@/lib/report-fees", () => ({ feesKeptSince: async () => ({ kept: 0, unverified: 0 }) }));
import { readCosts } from "@/lib/costs/server";

let f: ReturnType<typeof returnFixture>;
const now = new Date("2026-11-10T18:00:00Z");
beforeEach(() => {
  f = returnFixture();
  db.from.mockImplementation(table => table === "restaurants"
    ? { select: () => ({ eq: () => ({ single: async () => ({ data: { currency: "MXN", tax_pct: 0, terminal_fee_pct: 0 }, error: null }) }) }) }
    : f.from(table));
  db.rpc.mockImplementation((name, args) => name === "order_return_events_v1" ? eventQuery(f, args)
    : name === "terminal_deposit_ledger_v1" ? f.from("terminal_ledger")
    : Promise.resolve({ data: { outstanding_cents: 0 }, error: null }));
  f.tables.orders = [{ id: "sale", restaurant_id: "r1", currency: "MXN", total: 50, service_fee: 0, tip: 0,
    tax_pct: 0, subtotal: 100, paid: true, status: "completed", created_at: "2026-11-01T12:00:00Z",
    items: [{ itemId: "dish", name: "Dish", price: 100, qty: 1, mods: {} }] }];
  f.tables.ingredient_consumption = [{ source_id: "sale", restaurant_id: "r1", source_kind: "sale", cost_currency: "MXN", line_costs: [40] }];
  f.tables.order_adjustments = [{ id: "adjustment", restaurant_id: "r1", order_id: "sale", currency: "MXN", kind: "return",
    previous_total: 80, resulting_total: 50, previous_tip: 0, resulting_tip: 0, previous_service_fee: 0, resulting_service_fee: 0 }];
  f.tables.refund_operations = [{ id: "operation", adjustment_id: "adjustment", restaurant_id: "r1", currency: "MXN",
    amount: 30, tip: 0, status: "succeeded", "order_adjustments.kind": "return" }];
  f.tables.return_events = [{ id: "event", operation_id: "operation", order_id: "sale", restaurant_id: "r1", currency: "MXN",
    kind: "return", amount_cents: 3000, succeeded_at: "2026-11-09T12:00:00Z" }];
});

it("F2 MX$100 less MX$20 discount, MX$30 completed return and MX$40 cost leaves MX$10", async () => {
  const { period } = await readCosts("r1", now);
  expect(period.revenue).toBe(80); // Keep the historical sale.
  expect(period.cost).toBe(40); // Giving money back does not unmake food.
  expect(period.contribution, "restoring the MX$30 return without deducting it overstates contribution by MX$30").toBe(10);
  expect(period.rows[0]).toMatchObject({ units: 1, revenue: 80, cost: 40, contribution: 10 });
  const restored = await withReturnComponents(db as never, "r1", f.tables.orders as never);
  const analytics = computeAnalytics(restored as never, "30d", "UTC", now);
  expect(analytics.revenue).toBe(80);
  expect(analytics.topProducts[0].revenue).toBe(80);
  expect(await saleReturnSummary(db as never, "r1", "MXN", "2026-10-11T18:00:00Z", now.toISOString()))
    .toEqual({ completed: 30, pending: 0 }); // Analytics deducts this separately, exactly once.
});

it("F2 deducts today's return of an older sale without reselling it or repeating its ingredient cost", async () => {
  f.tables.orders[0].created_at = "2026-09-01T12:00:00Z";
  const { period } = await readCosts("r1", now);
  expect(period).toMatchObject({ revenue: 0, cost: 0, contribution: -30 });
  expect(period.rows[0]).toMatchObject({ units: 0, revenue: 0, cost: 0, contribution: -30 });
});

it("F2 dates successful pieces, excluding pending, foreign, cancellation and out-of-window returns", async () => {
  const event = f.tables.return_events[0];
  f.tables.refund_operations[0].status = "processing";
  f.tables.return_events = [{ ...event, amount_cents: 1000 },
    { ...event, id: "earlier", amount_cents: 2000, succeeded_at: "2026-10-01T12:00:00Z" },
    { ...event, id: "end", succeeded_at: now.toISOString() },
    { ...event, id: "foreign", restaurant_id: "r2" }, { ...event, id: "usd", currency: "USD" },
    { ...event, id: "cancel", kind: "cancel" }];
  expect((await readCosts("r1", now)).period.contribution).toBe(30);
  f.tables.return_events = [];
  expect((await readCosts("r1", now)).period.contribution).toBe(40);
});

it("F2 excludes returned service, tip and IVA from product contribution", async () => {
  Object.assign(f.tables.orders[0], { total: 50, service_fee: 5, tip: 10, tax_pct: 20 });
  Object.assign(f.tables.order_adjustments[0], { previous_total: 110, resulting_total: 50,
    previous_tip: 20, resulting_tip: 10, previous_service_fee: 10, resulting_service_fee: 5 });
  Object.assign(f.tables.refund_operations[0], { amount: 60, tip: 10 });
  f.tables.return_events[0].amount_cents = 6000;
  const { period } = await readCosts("r1", now);
  expect(period.revenue).toBeCloseTo(80 / 1.2);
  expect(period.contribution).toBeCloseTo((80 - 45) / 1.2 - 40);
});

it("F2 fails the report when dated return evidence cannot be read", async () => {
  db.rpc.mockImplementation(name => name === "terminal_deposit_ledger_v1" ? f.from("terminal_ledger") : ({ gte: () => ({ lt: () => ({ eq: () => ({ order: () => ({
    range: async () => ({ data: null, error: { message: "return evidence unavailable" } }),
  }) }) }) }) }));
  await expect(readCosts("r1", now)).rejects.toThrow("return evidence unavailable");
});
