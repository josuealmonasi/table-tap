import { beforeEach, expect, it, vi } from "vitest";
import * as React from "react";

const state = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, failed: "" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: query, rpc: async () => ({ data: [], error: null }) }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: query }) }));
vi.mock("@/lib/page-guard", () => ({ requireManager: async () => ({ restaurant: { id: "r", currency: "USD", timezone: "UTC" } }) }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => null }));
vi.mock("@/lib/cash-shift-server", () => ({ todaysShiftViews: async () => [] }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ ConfirmProvider: () => null }));
vi.mock("@/components/dashboard/analytics/AnalyticsView", () => ({ default: () => null }));

function query(table: string) {
  const filters: ((row: Record<string, unknown>) => boolean)[] = [];
  let offset = 0;
  let columns = "*";
  const result = () => {
    const data = (state.rows[table] ?? []).filter(row => filters.every(f => f(row)));
    return { data: data.slice(offset, offset + 2).map(row => columns === "*" ? row
      : Object.fromEntries(columns.split(",").map(c => [c.trim(), row[c.trim()]]))),
    count: data.length, error: state.failed === table ? { message: "read failed" } : null };
  };
  const q = {
    select: (s: string) => { columns = s; return q; },
    eq: (k: string, v: unknown) => { filters.push(row => row[k] === v); return q; },
    neq: (k: string, v: unknown) => { filters.push(row => row[k] !== v); return q; },
    is: (k: string, v: unknown) => { filters.push(row => (row[k] ?? null) === v); return q; },
    not: (k: string) => { filters.push(row => row[k] != null); return q; },
    in: (k: string, vs: unknown[]) => { filters.push(row => vs.includes(row[k])); return q; },
    gte: (k: string, v: string) => { filters.push(row => String(row[k]) >= v); return q; },
    lt: (k: string, v: string) => { filters.push(row => String(row[k]) < v); return q; },
    order: () => q, or: () => q,
    range: (a: number) => { offset = a; return q; },
    single: async () => ({ ...result(), data: result().data[0] }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  };
  return q;
}

const { default: AnalyticsPage } = await import("@/app/dashboard/analytics/page");
const { readCosts } = await import("@/lib/costs/server");
const { feesKeptSince } = await import("@/lib/report-fees");
const { withOrderCurrency } = await import("@/lib/log-money");
const now = new Date("2026-10-21T18:00:00Z");
beforeEach(() => {
  vi.stubGlobal("React", React);
  state.failed = "";
  state.rows = { restaurants: [{ id: "r", currency: "USD", tax_pct: 0, terminal_fee_pct: 0 }] };
});

it("I8: MX$100 plus US$10 account debt is US$10 in the USD corte", async () => {
  state.rows.orders = ["MXN", "USD"].map(currency => ({
    restaurant_id: "r", currency, account_id: currency, total: currency === "MXN" ? 100 : 10,
    paid: false, written_off: false, status: "completed",
  }));
  const page = await AnalyticsPage({ searchParams: Promise.resolve({}) });
  expect(page.props.children.props.corte.accountsOwed).toBe(10);
});

it("I8: foreign and unverified log amounts cannot enter current-currency adjustments", async () => {
  state.rows.user_logs = [
    { restaurant_id: "r", action: "discounted", detail: "amount=100 currency=MXN" },
    { restaurant_id: "r", action: "discounted", detail: "amount=10 currency=USD" },
    { restaurant_id: "r", action: "written_off", detail: "amount=80" },
  ].map(row => ({ ...row, entity: row.action === "written_off" ? "bill" : "discount", created_at: new Date().toISOString() }));
  const page = await AnalyticsPage({ searchParams: Promise.resolve({}) });
  expect(page.props.children.props.corte).toMatchObject({ discounted: 10, writtenOff: 0 });
  expect(page.props.children.props.corte.unverifiedAdjustments).toBe(1);
});

it("I10: an old MX$10 platform fee cannot create a 10% rate on US$100 cash", async () => {
  state.rows.payments = [{ restaurant_id: "r", currency: "USD", amount: 100, method: "cash", created_at: now.toISOString() }];
  state.rows.platform_fees = [{ restaurant_id: "r", status: "taken", cents: 1000, refunded_cents: 0,
    stripe_payment_intent: "pi_mxn", settled_at: now.toISOString() }];
  state.rows.diner_checkouts = [{ restaurant_id: "r", currency: "MXN", stripe_payment_intent: "pi_mxn" }];
  const view = await readCosts("r", now);
  expect(view.fees.takings).toBe(100);
  expect(view.fees.fees).toBe(0);
  expect(view.fees.rate).toBe(0);
});

it("uses only the same restaurant's charge currency, net of returned fees", async () => {
  state.rows.platform_fees = ["usd", "mxn", "unknown", "foreign", null].map(intent => ({
    restaurant_id: "r", status: "taken", cents: "1000", refunded_cents: "250",
    stripe_payment_intent: intent, settled_at: now.toISOString(),
  }));
  state.rows.diner_checkouts = [
    { restaurant_id: "r", stripe_payment_intent: "usd", currency: "USD" },
    { restaurant_id: "r", stripe_payment_intent: "mxn", currency: "MXN" },
    { restaurant_id: "other", stripe_payment_intent: "foreign", currency: "USD" },
  ];
  expect(await feesKeptSince("r", "2026-10-01", "USD")).toEqual({ kept: 7.5, unverified: 3 });
});

it("pages fees and chunks charge evidence without counting receipts again", async () => {
  state.rows.platform_fees = Array.from({ length: 151 }, (_, i) => ({
    restaurant_id: "r", status: "taken", cents: 1, refunded_cents: 0,
    stripe_payment_intent: `pi_${i}`, settled_at: now.toISOString(),
  }));
  state.rows.diner_checkouts = state.rows.platform_fees.map(f => ({
    restaurant_id: "r", stripe_payment_intent: f.stripe_payment_intent, currency: "USD",
  }));
  expect(await feesKeptSince("r", "2026-10-01", "USD")).toEqual({ kept: 1.51, unverified: 0 });
});

it.each(["platform_fees", "diner_checkouts", "payments", "orders"])("refuses a partial report when %s cannot be read", async table => {
  state.rows.platform_fees = [{ restaurant_id: "r", status: "taken", cents: 1000, refunded_cents: 0,
    stripe_payment_intent: "pi_1", settled_at: now.toISOString() }];
  state.failed = table;
  await expect(readCosts("r", now)).rejects.toThrow("read failed");
});

it("reads final food revenue for both the costs and analytics pages", async () => {
  const at = new Date().toISOString();
  state.rows.orders = [{ id: "dish-sale", restaurant_id: "r", currency: "USD", paid: true, status: "completed",
    items: [{ itemId: "dish", name: "Dish", price: 100, qty: 1, mods: {} }],
    subtotal: 100, total: 110, service_fee: 10, tip: 20, tax_pct: 0, created_at: at }];
  expect((await readCosts("r", new Date())).period.uncosted).toBe(80);
  const page = await AnalyticsPage({ searchParams: Promise.resolve({}) });
  expect(page.props.children.props.data.topProducts[0].revenue).toBe(80);
});

it("writes original order currency into new activity, leaving mixed or missing scopes unverified", async () => {
  state.rows.orders = [{ id: "mxn", restaurant_id: "r", currency: "MXN" }, { id: "usd", restaurant_id: "r", currency: "USD" }];
  expect(await withOrderCurrency("amount=100", "r", ["mxn"])).toBe("amount=100 currency=MXN");
  expect(await withOrderCurrency("amount=110", "r", ["mxn", "usd"])).toBe("amount=110");
  expect(await withOrderCurrency("amount=100", "r", ["missing"])).toBe("amount=100");
  expect(await withOrderCurrency("amount=100", "other", ["mxn"])).toBe("amount=100");
});

it("keeps an activity write available when its currency evidence cannot be read", async () => {
  state.failed = "orders";
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await withOrderCurrency("amount=100", "r", ["sale"])).toBe("amount=100");
    expect(log).toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});

it("counts an approved discount once while leaving ingredient waste and duplicate-charge returns out", async () => {
  state.rows.user_logs = [
    { entity: "discount", action: "approved", detail: "amount=20 currency=USD" },
    { entity: "costs", action: "written_off", detail: "amount=40 currency=USD" },
    { entity: "bill", action: "refunded", detail: "amount=100 why=paid_twice" },
  ].map(row => ({ ...row, restaurant_id: "r", created_at: new Date().toISOString() }));
  const page = await AnalyticsPage({ searchParams: Promise.resolve({}) });
  expect(page.props.children.props.corte).toMatchObject({ discounted: 20, writtenOff: 0, refunded: 0, unverifiedAdjustments: 0 });
});
