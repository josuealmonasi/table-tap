import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const retrieve = vi.fn();
const rpc = vi.fn();
const reads: unknown[] = [];
const writes: unknown[] = [];
const patches: Record<string, unknown>[] = [];
vi.mock("@/lib/stripe", () => ({ stripe: { subscriptions: { retrieve: (...args: unknown[]) => retrieve(...args) } } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: (...args: unknown[]) => rpc(...args),
  from: () => {
    let writing = false;
    const q = {
      select: () => q,
      eq: () => q,
      update: (patch: Record<string, unknown>) => { writing = true; patches.push(patch); return q; },
      maybeSingle: async () => reads.shift(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(writing ? writes.shift() : reads.shift()).then(resolve),
    };
    return q;
  },
}) }));
const { applySubscription } = await import("@/lib/subscription-sync");
const sub = (id = "sub_new", created = 200, status = "active") => ({
  id, created, status, metadata: { restaurant_id: "r1", plan: "casa" },
  items: { data: [{ price: { unit_amount: 149900 } }] },
}) as unknown as Stripe.Subscription;
const current = (id = "sub_new", revision = 0) => ({
  data: { stripe_subscription_id: id, subscription_sync_revision: revision }, error: null,
});
const down = { data: null, error: { message: "database unavailable" } };

beforeEach(() => {
  vi.resetAllMocks();
  reads.length = writes.length = patches.length = 0;
  rpc.mockResolvedValue({ data: 1, error: null });
  retrieve.mockResolvedValue(sub());
  writes.push({ data: [{ id: "r1" }], error: null });
});

describe("subscription synchronization", () => {
  it("throws a failed write so the webhook is retried", async () => {
    reads.push(current()); writes[0] = down;
    await expect(applySubscription(sub())).rejects.toThrow("Subscription update failed");
  });
  it("throws a failed read without updating the plan", async () => {
    reads.push(down);
    await expect(applySubscription(sub())).rejects.toThrow("Subscription lookup failed");
    expect(patches).toEqual([]);
  });
  it("uses Stripe's current state instead of the event's older snapshot", async () => {
    reads.push(current());
    await applySubscription(sub("sub_new", 200, "past_due"));
    expect(patches[0]).toMatchObject({ plan: "casa", plan_status: "active", subscription_sync_revision: 1 });
  });
  it("ignores a late cancellation from an older subscription", async () => {
    reads.push(current());
    retrieve.mockResolvedValueOnce(sub("sub_old", 100, "canceled")).mockResolvedValueOnce(sub());
    await applySubscription(sub("sub_old", 100, "canceled"));
    expect(patches).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("re-reads Stripe after another worker changed the revision", async () => {
    reads.push(current(), current("sub_new", 1));
    writes[0] = { data: [], error: null };
    writes.push({ data: [{ id: "r1" }], error: null });
    retrieve.mockResolvedValueOnce(sub()).mockResolvedValueOnce(sub("sub_new", 200, "canceled"));
    await applySubscription(sub());
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(patches[1]).toMatchObject({ plan: "carta", subscription_sync_revision: 2 });
  });
  it("asks Stripe to retry when the founder claim fails", async () => {
    reads.push(current()); rpc.mockResolvedValue(down);
    await expect(applySubscription(sub())).rejects.toThrow("Founding claim failed");
    expect(patches).toEqual([]);
  });
});

it("propagates a Stripe read failure so it can be retried", async () => {
  reads.push(current()); retrieve.mockRejectedValue(new Error("Stripe unavailable"));
  await expect(applySubscription(sub())).rejects.toThrow("Stripe unavailable");
  expect(patches).toEqual([]);
});

it("accepts a newer replacement subscription", async () => {
  reads.push(current("sub_old"));
  retrieve.mockResolvedValueOnce(sub()).mockResolvedValueOnce(sub("sub_old", 100, "canceled"));
  await applySubscription(sub());
  expect(patches[0]).toMatchObject({ stripe_subscription_id: "sub_new", plan_status: "active" });
});

it("fails after bounded concurrent updates rather than acknowledging unfinished work", async () => {
  reads.push(current(), current("sub_new", 1), current("sub_new", 2));
  writes.splice(0, writes.length, ...Array.from({ length: 3 }, () => ({ data: [], error: null })));
  await expect(applySubscription(sub())).rejects.toThrow("retry required");
  expect(retrieve).toHaveBeenCalledTimes(3);
});
