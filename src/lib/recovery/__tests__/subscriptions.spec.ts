import { beforeEach, expect, it, vi } from "vitest";
import { fixture, old } from "./fixtures";

const { apply } = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/subscription-sync", () => ({ applySubscription: apply }));
const { recoverSubscriptions } = await import("../subscriptions");

const day = 24 * 3600 * 1000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();
const paid = (over: Record<string, unknown> = {}) => ({ id: "r1", plan: "casa", plan_status: "active",
  stripe_subscription_id: "sub", created_at: old, plan_ends_at: null, plan_period_ends_at: null, ...over });
let f: ReturnType<typeof fixture>;
beforeEach(() => { vi.clearAllMocks(); f = fixture(); });

/** What the webhook transition would store for Stripe's answer. */
function storesStripeState() {
  apply.mockImplementation(async (sub: { status: string; current_period_end?: string }) => {
    const row = f.tables.restaurants[0];
    if (sub.status === "canceled") Object.assign(row, { plan: "carta", plan_status: "active", plan_ends_at: null, plan_period_ends_at: null });
    else if (sub.status === "unpaid") Object.assign(row, { plan_status: "locked" });
    else Object.assign(row, { plan_period_ends_at: sub.current_period_end });
  });
}

it("finding 3: a cancellation whose webhook never arrived downgrades through the webhook transition", async () => {
  f.tables.restaurants = [paid({ plan_ends_at: ago(4), plan_period_ends_at: ago(4) })];
  const sub = { id: "sub", status: "canceled", metadata: { restaurant_id: "r1" } };
  f.client.subscriptions.retrieve.mockResolvedValue(sub);
  storesStripeState();
  expect(await recoverSubscriptions(f.context)).toMatchObject({ done: 1, pending: 0, failed: 0 });
  expect(apply).toHaveBeenCalledWith(sub, f.context.db, f.context.client, "sub");
  expect(f.tables.restaurants[0]).toMatchObject({ plan: "carta" });
});

it("finding 3: an unpaid renewal past its period end locks through the existing path", async () => {
  f.tables.restaurants = [paid({ plan_period_ends_at: ago(5) })];
  f.client.subscriptions.retrieve.mockResolvedValue({ id: "sub", status: "unpaid", metadata: { restaurant_id: "r1" } });
  storesStripeState();
  expect(await recoverSubscriptions(f.context)).toMatchObject({ done: 1, failed: 0 });
  expect(f.tables.restaurants[0]).toMatchObject({ plan: "casa", plan_status: "locked" });
});

it("finding 3: a Stripe read error never downgrades and stays pending", async () => {
  f.tables.restaurants = [paid({ plan_period_ends_at: ago(5) })];
  f.client.subscriptions.retrieve.mockRejectedValue(new Error("Stripe offline"));
  expect(await recoverSubscriptions(f.context)).toMatchObject({ done: 0, pending: 1, failed: 1 });
  expect(apply).not.toHaveBeenCalled();
  expect(f.tables.restaurants[0]).toMatchObject({ plan: "casa", plan_status: "active" });
});

it("finding 3: a renewal that Stripe confirms moves the period forward and leaves the queue", async () => {
  f.tables.restaurants = [paid({ plan_period_ends_at: ago(4) })];
  f.client.subscriptions.retrieve.mockResolvedValue({ id: "sub", status: "active", metadata: { restaurant_id: "r1" },
    current_period_end: new Date(Date.now() + 26 * day).toISOString() });
  storesStripeState();
  expect(await recoverSubscriptions(f.context)).toMatchObject({ done: 1, pending: 0 });
  expect(f.tables.restaurants[0]).toMatchObject({ plan: "casa", plan_status: "active" });
});

it("finding 3: leaves restaurants inside the grace window, on the free tier or without a subscription alone", async () => {
  f.tables.restaurants = [paid({ plan_period_ends_at: ago(1) }), paid({ id: "r2", plan: "carta", plan_period_ends_at: ago(9) }),
    paid({ id: "r3", stripe_subscription_id: null, plan_period_ends_at: ago(9) }), paid({ id: "r4", plan_period_ends_at: null })];
  expect(await recoverSubscriptions(f.context)).toMatchObject({ done: 0, pending: 0, failed: 0 });
  expect(f.client.subscriptions.retrieve).not.toHaveBeenCalled();
});
