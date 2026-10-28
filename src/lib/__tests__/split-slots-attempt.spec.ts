import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
const s = vi.hoisted(() => ({ calls: [] as string[], outcome: "reserved", failure: 0, expired: false, reserveError: false, attempt: null as Record<string, unknown> | null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    s.calls.push(name);
    if (name === "reserve_split_slots_v1" && s.reserveError) return { data: null, error: { message: "connection lost" } };
    if (name === "diner_checkout_open") { s.attempt ??= args.p_record as Record<string, unknown>; return { data: s.attempt, error: null }; }
    return { data: { outcome: name === "release_split_slots_v1" ? "released" : s.outcome, amount_cents: 10000, fee_cents: 100 }, error: null };
  },
  from: () => {
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "limit"]) q[op] = () => q;
    q.maybeSingle = q.single = async () => ({ data: s.attempt, error: null });
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
    return q;
  },
}) }));
vi.mock("@/lib/diner-checkout", () => ({ recordDinerCheckout: async () => {}, stripeLiveMode: () => false, requireVerifiedCheckout: () => {} }));
vi.mock("@/lib/platform-fee", () => ({ releaseFee: async () => { s.calls.push("release_fee"); }, stripeRefusedOutright: (e: { statusCode?: number }) => e.statusCode === 400 }));
const { openDinerAttempt, resumeDinerAttempt } = await import("@/lib/diner-attempt");
const create = vi.fn(async () => {
  s.calls.push("stripe");
  if (s.failure) throw Object.assign(new Error("provider"), { statusCode: s.failure });
  return { id: "cs", status: s.expired ? "expired" : "open", url: s.expired ? null : "url" };
});
const stripe = { checkout: { sessions: { create, retrieve: create, expire: vi.fn() } } } as unknown as Stripe;
const params = { metadata: { restaurant_id: "r", split_id: "split", split_model: "2", split_revision: "1", split_member: "m",
  split_slots: "[0,1]", split_amount: "100", fee_cents: "100", fee_id: "fee" } } as Stripe.Checkout.SessionCreateParams;
const quote = { restaurantId: "r", stripeAccount: "acct", currency: "MXN", amountCents: 10000,
  orderIds: ["o"], payableIds: [], scopeKey: "split2:split:1:m:0,1", foodPrincipal: 100 };
beforeEach(() => { s.calls = []; s.outcome = "reserved"; s.failure = 0; s.expired = false; s.reserveError = false; s.attempt = null; create.mockClear(); });
it("persists the attempt then reserves all slots before Stripe", async () => {
  await openDinerAttempt(stripe, params, quote);
  expect(s.calls.slice(0, 3)).toEqual(["diner_checkout_open", "reserve_split_slots_v1", "stripe"]);
});
it.each(["taken", "paid", "stale", "below_minimum", "conflict"])("a %s selection creates no payable Stripe page", async outcome => {
  s.outcome = outcome;
  await expect(openDinerAttempt(stripe, params, quote)).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
  expect(s.calls).not.toContain("release_split_slots_v1");
});
it("a lost provider answer keeps slots and retries its exact saved request", async () => {
  s.failure = 500;
  await expect(openDinerAttempt(stripe, params, quote)).rejects.toThrow("provider");
  expect(s.calls).not.toContain("release_split_slots_v1");
  s.failure = 0; s.outcome = "repeat";
  await resumeDinerAttempt(stripe, "r", quote.scopeKey);
  expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
  expect(s.calls.filter(name => name === "reserve_split_slots_v1")).toHaveLength(2);
});
it("positive provider refusal releases this attempt's slots", async () => {
  s.failure = 400;
  await expect(openDinerAttempt(stripe, params, quote)).rejects.toThrow("provider");
  expect(s.calls).toContain("release_split_slots_v1");
});

it("a confirmed expiry on resume releases the saved attempt before requoting", async () => {
  await openDinerAttempt(stripe, params, quote);
  s.attempt!.stripe_session_id = "cs"; s.expired = true; s.calls = [];
  expect(await resumeDinerAttempt(stripe, "r", quote.scopeKey)).toBeNull();
  expect(s.calls).toEqual(["stripe", "release_split_slots_v1", "release_fee", "finish_diner_checkout"]);
});
it("an uncertain reservation response keeps both fee and parts for retry", async () => {
  s.reserveError = true;
  await expect(openDinerAttempt(stripe, params, quote)).rejects.toThrow("connection lost");
  expect(create).not.toHaveBeenCalled();
  expect(s.calls).not.toContain("release_fee");
  expect(s.calls).not.toContain("release_split_slots_v1");
});
it("a provider idempotency conflict does not prove refusal", async () => {
  s.failure = 409;
  await expect(openDinerAttempt(stripe, params, quote)).rejects.toThrow("provider");
  expect(s.calls).not.toContain("release_fee");
  expect(s.calls).not.toContain("release_split_slots_v1");
});
