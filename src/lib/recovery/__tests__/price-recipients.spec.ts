import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as unknown[], results: [] as unknown[], upserts: [] as unknown[] }));
vi.mock("../job", () => ({
  runBatch: async (_n: string, _c: unknown, _p: unknown, handle: (row: unknown) => Promise<boolean>) => {
    for (const row of state.rows) { try { state.results.push(await handle(row)); } catch (e) { state.results.push((e as Error).message); } }
    return { done: 0, pending: 0, failed: 0 };
  },
}));
import { recoverPriceRecipients } from "../price-recipients";

const founders = new Set(["r_founder"]);
const db = {
  from: (table: string) => {
    let ids: string[] = [];
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      eq: () => (table === "restaurant_subscription_prices" ? Promise.resolve({ data: [{ price_id: "price_casa" }], error: null }) : q),
      in: (_c: string, v: string[]) => ((ids = v), q),
      is: () => Promise.resolve({ data: ids.filter(id => !founders.has(id)).map(id => ({ id })), error: null }),
      upsert: async (rows: unknown) => (state.upserts.push(rows), { error: null }),
    });
    return q;
  },
};
const sub = (restaurant: string, price: string, items = 1) => ({
  metadata: { restaurant_id: restaurant }, items: { data: Array.from({ length: items }, () => ({ price: { id: price } })) },
});
const client = { subscriptions: { list: async ({ status }: { status: string }) => ({ has_more: false, data:
  status === "active" ? [sub("r_late_sync", "price_casa"), sub("r_founder", "price_casa"), sub("r_other_tier", "price_caja"), sub("r_two_items", "price_casa", 2)]
    : status === "past_due" ? [sub("r_overdue", "price_casa")] : [] }) } };
const ctx = () => ({ db, client, deadline: Date.now() + 60_000 }) as never;

beforeEach(() => { state.rows = [{ id: "c1", plan: "casa", created_at: "2026-11-18T00:00:00Z" }]; state.results = []; state.upserts = []; });

it("queues every subscriber Stripe bills on the tier, except founders (review finding 4)", async () => {
  await recoverPriceRecipients(ctx());
  expect(state.results).toEqual([true]);
  expect(state.upserts).toEqual([[{ change_id: "c1", restaurant_id: "r_late_sync" }, { change_id: "c1", restaurant_id: "r_overdue" }]]);
});
