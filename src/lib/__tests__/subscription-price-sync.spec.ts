import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const retrieve = vi.fn();
const readRestaurant = vi.fn();
const readPrice = vi.fn();
const claimFounder = vi.fn();
const patches: Record<string, unknown>[] = [];
const restaurant = { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_r1", subscription_sync_revision: 0 };
vi.mock("@/lib/stripe", () => ({ stripe: { subscriptions: { retrieve: (...a: unknown[]) => retrieve(...a) } } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: (...args: unknown[]) => claimFounder(...args),
  from: (table: string) => {
    const q = {
      select: () => q, eq: () => q,
      maybeSingle: async () => table === "restaurants" ? readRestaurant() : readPrice(table),
      update: (patch: Record<string, unknown>) => { patches.push(patch); return q; },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: "r1" }], error: null }).then(resolve),
    }; return q;
  },
}) }));
const { applySubscription } = await import("@/lib/subscription-sync");
const subscription = { id: "sub_1", status: "active", customer: "cus_r1", metadata: { restaurant_id: "r1", plan: "servicio" },
  items: { data: [{ price: { id: "price_casa", unit_amount: 149900 } }] },
} as unknown as Stripe.Subscription;
beforeEach(() => {
  vi.resetAllMocks();
  patches.length = 0;
  retrieve.mockResolvedValue(subscription);
  readRestaurant.mockResolvedValue({ data: restaurant, error: null });
  readPrice.mockResolvedValue({ data: { plan: "casa" }, error: null });
  claimFounder.mockResolvedValue({ data: 1, error: null });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("D5 sync grants the purchased Price tier when subscription metadata is stale", async () => {
  await applySubscription(subscription);
  expect(patches[0]).toMatchObject({ plan: "casa", plan_status: "active" });
});

it.each(["cus_other", null])("refuses to link when the stored billing customer is %s", async customer => {
  readRestaurant.mockResolvedValue({
    data: { ...restaurant, stripe_subscription_id: null, stripe_customer_id: customer }, error: null,
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await applySubscription(subscription);
  expect(log).toHaveBeenCalledWith(expect.stringContaining("customer mismatch"), "sub_1", "r1");
  expect(patches).toEqual([]);
  expect(readPrice).not.toHaveBeenCalled();
  expect(claimFounder).not.toHaveBeenCalled();
});

it("matches an expanded Customer from the retrieved subscription", async () => {
  readRestaurant.mockResolvedValue({ data: { ...restaurant, stripe_subscription_id: null }, error: null });
  retrieve.mockResolvedValue({ ...subscription, customer: { id: "cus_r1" } });
  await applySubscription({ ...subscription, customer: "cus_old_event" });
  expect(patches[0]).toMatchObject({ stripe_subscription_id: "sub_1", plan: "casa" });
});

it.each(["unpaid", "paused"])("persists the %s lock without looking up the Price", async status => {
  retrieve.mockResolvedValue({ ...subscription, status });
  readPrice.mockResolvedValue({ data: null, error: { message: "Price registry unavailable" } });
  await applySubscription(subscription);
  expect(patches).toEqual([expect.objectContaining({
    plan: "carta", plan_status: "locked", stripe_subscription_id: "sub_1", subscription_sync_revision: 1,
  })]);
  expect(readPrice).not.toHaveBeenCalled();
  expect(claimFounder).not.toHaveBeenCalled();
});

it.each(["active", "trialing", "past_due"])("locks a %s subscription with an unmapped Price to Carta", async status => {
  retrieve.mockResolvedValue({
    ...subscription, status, items: { data: [{ price: { id: "price_new", unit_amount: 69900 } }] },
  });
  readPrice.mockResolvedValue({ data: null, error: null });
  await applySubscription(subscription);
  expect(patches).toEqual([expect.objectContaining({
    plan: "carta", plan_status: "locked", stripe_subscription_id: "sub_1", subscribed_price: 699,
  })]);
  expect(claimFounder).not.toHaveBeenCalled();
});

it("retries a failed Price lookup for an active subscription", async () => {
  readPrice.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
  await expect(applySubscription(subscription)).rejects.toThrow("Subscription Price lookup failed");
  expect(patches).toEqual([]);
});

it("restores the mapped tier after the Price is registered", async () => {
  readPrice.mockResolvedValue({ data: null, error: null });
  await applySubscription(subscription);
  readRestaurant.mockResolvedValue({ data: { ...restaurant, subscription_sync_revision: 1 }, error: null });
  readPrice.mockResolvedValue({ data: { plan: "servicio" }, error: null });
  await applySubscription(subscription);
  expect(patches).toEqual([
    expect.objectContaining({ plan: "carta", plan_status: "locked", subscription_sync_revision: 1 }),
    expect.objectContaining({ plan: "servicio", plan_status: "active", subscription_sync_revision: 2 }),
  ]);
});
