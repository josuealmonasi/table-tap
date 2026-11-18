import { beforeEach, describe, expect, it, vi } from "vitest";

// Each job's handler is fed the rows directly: what matters here is what it
// does with one notice, not the paging around it.
const state = vi.hoisted(() => ({ rows: [] as unknown[], results: [] as unknown[], updates: [] as Record<string, unknown>[] }));
vi.mock("../job", () => ({
  runBatch: async (_name: string, _ctx: unknown, _page: unknown, handle: (row: unknown) => Promise<boolean>) => {
    for (const row of state.rows) {
      try { state.results.push(await handle(row)); } catch (e) { state.results.push((e as Error).message); }
    }
    return { done: 0, pending: 0, failed: 0 };
  },
}));
vi.mock("@/lib/subscription-price", () => ({ registerSubscriptionPrice: vi.fn(async () => {}) }));
import { moveBoundary, recoverPriceMoves, recoverPriceCatalogue, NOTICE_DAYS } from "../price-moves";

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const db = {
  from: () => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    Object.assign(q, { eq: chain, is: chain, update: (p: Record<string, unknown>) => (state.updates.push(p), q),
      then: (resolve: (v: unknown) => void) => resolve({ error: null }) });
    return q;
  },
};
const calls: { schedule?: Record<string, unknown>; price?: Record<string, unknown> } = {};
const subscription = (over: Record<string, unknown> = {}) => ({
  id: "sub_1", status: "active", cancel_at_period_end: false, cancel_at: null, schedule: null,
  items: { data: [{ current_period_end: sec("2026-12-05T00:00:00Z"),
    price: { id: "price_old", currency: "mxn", product: "prod_casa", recurring: { interval: "month", interval_count: 1 } } }] },
  ...over,
});
let sub = subscription();
const client = {
  subscriptions: { retrieve: async () => sub },
  prices: { create: async (p: Record<string, unknown>) => ((calls.price = p), { id: "price_new" }) },
  subscriptionSchedules: {
    create: async () => ({ id: "sched_1", phases: [{ start_date: sec("2026-11-05T00:00:00Z") }] }),
    update: async (_id: string, p: Record<string, unknown>) => ((calls.schedule = p), { id: "sched_1" }),
  },
};
const ctx = () => ({ db, client, deadline: Date.now() + 60_000 }) as never;
const notice = (sentAt: string, effectiveAt: string) => ({
  change_id: "c1", restaurant_id: "r1", created_at: sentAt, sent_at: sentAt,
  plan_price_changes: { plan: "casa", new_monthly_price: 2999, effective_at: effectiveAt },
  restaurants: { stripe_subscription_id: "sub_1" },
});

beforeEach(() => { state.rows = []; state.results = []; state.updates = []; calls.schedule = undefined; calls.price = undefined; sub = subscription(); });

describe("the renewal the new price starts at", () => {
  it("is the first period end on or after the later of the date and 30 days of notice", () => {
    expect(moveBoundary(sec("2026-12-05T00:00:00Z"), new Date("2026-12-01T00:00:00Z"))).toBe(sec("2026-12-05T00:00:00Z"));
    expect(moveBoundary(sec("2026-12-05T00:00:00Z"), new Date("2027-01-20T00:00:00Z"))).toBe(sec("2027-02-05T00:00:00Z"));
  });
});

describe("moving a notified subscriber", () => {
  it("schedules the new price from the renewal at least 30 days after the notice, with no proration", async () => {
    // Notice sent Nov 18, effective Dec 1: 30 days of notice wins → first renewal on/after Dec 18 = Jan 5.
    state.rows = [notice("2026-11-18T00:00:00Z", "2026-12-01T00:00:00Z")];
    await recoverPriceMoves(ctx());
    expect(state.results).toEqual([true]);
    expect(calls.price).toMatchObject({ currency: "mxn", unit_amount: 299900, product: "prod_casa" });
    const phases = calls.schedule!.phases as Record<string, unknown>[];
    expect(phases[0]).toMatchObject({ items: [{ price: "price_old", quantity: 1 }], end_date: sec("2027-01-05T00:00:00Z") });
    expect(phases[1]).toMatchObject({ items: [{ price: "price_new", quantity: 1 }], start_date: sec("2027-01-05T00:00:00Z"), proration_behavior: "none" });
    expect(sec("2027-01-05T00:00:00Z") * 1000 - Date.parse("2026-11-18T00:00:00Z")).toBeGreaterThanOrEqual(NOTICE_DAYS * 86_400_000);
    expect(state.updates.at(-1)).toMatchObject({ stripe_schedule_id: "sched_1", moves_at: "2027-01-05T00:00:00.000Z" });
  });

  it("skips, and records why, a subscription set to end or not monthly", async () => {
    state.rows = [notice("2026-11-18T00:00:00Z", "2026-12-01T00:00:00Z")];
    sub = subscription({ cancel_at_period_end: true });
    await recoverPriceMoves(ctx());
    expect(state.updates.at(-1)).toEqual({ move_skipped: "cancels" });
    sub = subscription({ items: { data: [{ current_period_end: 0, price: { id: "p", currency: "mxn", product: "x", recurring: { interval: "year", interval_count: 1 } } }] } });
    await recoverPriceMoves(ctx());
    expect(state.updates.at(-1)).toEqual({ move_skipped: "not_monthly" });
    expect(calls.schedule).toBeUndefined();
  });

  it("retries an overdue subscription on a later run instead of skipping it for good", async () => {
    state.rows = [notice("2026-11-18T00:00:00Z", "2026-12-01T00:00:00Z")];
    sub = subscription({ status: "past_due" });
    await recoverPriceMoves(ctx());
    expect(state.results).toEqual(["subscription not in good standing"]);
    expect(state.updates).toEqual([]);
  });
});

describe("the catalogue price for new subscriptions", () => {
  it("changes once at the effective date and clears the configured Stripe Price", async () => {
    state.rows = [{ id: "c1", created_at: "2026-11-18T00:00:00Z", plan: "casa", new_monthly_price: 2999 }];
    await recoverPriceCatalogue(ctx());
    expect(state.updates[0]).toEqual({ monthly_price: 2999, list_price: 2999, stripe_price_id: null });
    expect(state.updates[1]).toMatchObject({ applied_at: expect.any(String) });
  });
});
