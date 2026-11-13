import { beforeEach, expect, it, vi } from "vitest";
import { returnFixture } from "./returns-contract-fixtures";
import { depositDays } from "@/lib/terminal";

const state = vi.hoisted(() => ({ db: null as unknown, pct: 3.5 }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db }));
vi.mock("@/lib/report-fees", () => ({ feesKeptSince: async () => ({ kept: 0, unverified: 0 }) }));
vi.mock("@/lib/return-components", () => ({ withReturnComponents: async (_db: unknown, _r: string, orders: object[]) =>
  orders.map(o => ({ ...o, total: 100 })) }));
vi.mock("@/lib/costs/returns", () => ({ readContributionReturns: async () => [{ order: {
  total: 100, tax_pct: 0, ingredient_costs: [0], items: [{ itemId: "dish", name: "Dish", price: 100, qty: 1, mods: {} }],
}, food: 40 }] }));
import { readCosts } from "@/lib/costs/server";

let f: ReturnType<typeof returnFixture>;
const now = new Date("2026-11-10T18:00:00Z");
beforeEach(() => {
  f = returnFixture(); state.pct = 3.5;
  const restaurant = { currency: "MXN", tax_pct: 0, timezone: "America/Mexico_City", terminal_fee_pct: state.pct };
  state.db = { from: (table: string) => table === "restaurants"
    ? { select: () => ({ eq: () => ({ single: async () => ({ data: { ...restaurant, terminal_fee_pct: state.pct }, error: null }) }) }) }
    : f.from(table), rpc: () => f.from("terminal_ledger") };
  f.tables.orders = [{ id: "sale", restaurant_id: "r", currency: "MXN", paid: true, status: "completed", total: 60,
    tax_pct: 0, tip: 0, service_fee: 0, created_at: "2026-11-09T18:00:00Z",
    items: [{ itemId: "dish", name: "Dish", price: 100, qty: 1, mods: {} }] }];
  f.tables.ingredient_consumption = [{ source_id: "sale", restaurant_id: "r", source_kind: "sale", cost_currency: "MXN", line_costs: [0] }];
  f.tables.payments = [{ id: "p", restaurant_id: "r", currency: "MXN", amount: 100, method: "card", stripe_payment_intent: null,
    created_at: "2026-11-09T18:00:00Z" }];
  f.tables.terminal_ledger = [{ id: "p", amount: 100, tip: 0, created_at: "2026-11-09T18:00:00Z" },
    { id: "return:x", payment_id: "p", amount: 40, tip: 0, created_at: "2026-11-09T18:00:00Z", returned_at: "2026-11-09T20:00:00Z" }];
});

it("F4 MX$100 less MX$40 same-day return pays MX$2.10 and contributes MX$57.90", async () => {
  const view = await readCosts("r", now);
  expect(view.fees.fees).toBe(2.1);
  expect(view.period.contribution).toBeCloseTo(57.9);
  const [day] = depositDays(f.tables.terminal_ledger as never, [], 3.5, 1, "America/Mexico_City", "2026-11-10");
  expect(view.period.contribution).toBeCloseTo(day.expected);
});

it.each(["2026-11-09T19:00:00Z", "2026-11-09T21:00:00Z"])("F4 uses the signed rate after settings change, sign-off at %s", async created_at => {
  state.pct = 5;
  f.tables.terminal_deposits = [{ restaurant_id: "r", currency: "MXN", sales_day: "2026-11-09", fee_pct: 3.5, created_at,
    payment_ids: ["p"], return_ids: created_at.includes("21:") ? ["return:x"] : [] }];
  expect((await readCosts("r", now)).fees.fees).toBe(2.1);
});

it("F4 later-day return retains the original processing fee", async () => {
  f.tables.terminal_ledger[1].returned_at = "2026-11-10T12:00:00Z";
  const view = await readCosts("r", now);
  expect(view.fees.fees).toBeCloseTo(3.5);
  expect(view.period.contribution).toBeCloseTo(56.5);
});

it("F4 compares restaurant days across UTC midnight", async () => {
  f.tables.terminal_ledger[1].returned_at = "2026-11-10T02:00:00Z";
  expect((await readCosts("r", now)).fees.fees).toBe(2.1);
});

it("F4 excludes future returns from the report", async () => {
  f.tables.terminal_ledger[1].returned_at = "2026-11-10T19:00:00Z";
  expect((await readCosts("r", now)).fees.fees).toBeCloseTo(3.5);
});

it("F4 a signed zero rate stays zero after settings change", async () => {
  state.pct = 5;
  f.tables.terminal_deposits = [{ restaurant_id: "r", currency: "MXN", sales_day: "2026-11-09", fee_pct: 0,
    created_at: "2026-11-09T19:00:00Z", payment_ids: ["p"], return_ids: [] }];
  expect((await readCosts("r", now)).fees.fees).toBe(0);
});

it("F4 legacy same-day voids reverse the fee once", async () => {
  f.tables.terminal_ledger = [{ ...f.tables.terminal_ledger[0], voided_at: "2026-11-09T20:00:00Z" }];
  expect((await readCosts("r", now)).fees.fees).toBe(0);
});

it("F4 rounds the fee on daily net takings once", async () => {
  f.tables.terminal_ledger = Array.from({ length: 3 }, (_, i) => ({ ...f.tables.terminal_ledger[0], id: `p${i}`, amount: 0.1 }));
  expect((await readCosts("r", now)).fees.fees).toBe(0.01);
});

it("F4 refuses an incomplete terminal ledger", async () => {
  state.db = { ...(state.db as object), rpc: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: "terminal unavailable" } }) }) }) };
  await expect(readCosts("r", now)).rejects.toThrow("terminal unavailable");
});
