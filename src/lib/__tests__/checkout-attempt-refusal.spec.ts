import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";

// The real `stripeRefusedOutright` decides here: these are the two halves of
// bl43 #2 and #3. A 429 must keep a reservation whose page may still be in
// flight; a saved request Stripe now refuses outright must not hold the bill,
// coupon and fee forever.
const s = vi.hoisted(() => ({ calls: [] as { fn: string; args: Record<string, unknown> }[], attempt: null as Record<string, unknown> | null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (fn: string, args: Record<string, unknown>) => {
    s.calls.push({ fn, args });
    if (fn === "reserve_split_slots_v1") return { data: { outcome: "repeat", amount_cents: 50000, fee_cents: 0 }, error: null };
    if (fn === "retire_split_attempt_v1") return { data: { outcome: "retired" }, error: null };
    return { data: null, error: null };
  },
  from: () => {
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "limit"]) q[op] = () => q;
    q.maybeSingle = q.single = async () => ({ data: s.attempt, error: null });
    return q;
  },
}) }));
vi.mock("@/lib/diner-checkout", () => ({ recordDinerCheckout: async () => {}, stripeLiveMode: () => false, requireVerifiedCheckout: () => {} }));
const { resumeDinerAttempt } = await import("@/lib/diner-attempt");

const create = vi.fn();
const stripe = { checkout: { sessions: { create, retrieve: vi.fn(), expire: vi.fn() } } } as unknown as Stripe;
const minutesAgo = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();
const bill = (createdAt: string): Record<string, unknown> => ({
  id: "attempt", restaurant_id: "r", stripe_account_id: "acct", currency: "MXN", amount_cents: 50000,
  order_ids: ["o"], stripe_session_id: null, idempotency_key: "diner:attempt", created_at: createdAt,
  stripe_params: { expires_at: 1, metadata: { restaurant_id: "r", fee_id: "fee1" } },
});
const split = (): Record<string, unknown> => ({ ...bill(minutesAgo(1)), stripe_params: { metadata: {
  restaurant_id: "r", split_id: "split", split_model: "2", split_revision: "1", split_member: "m", split_slots: "[0]", split_amount: "500", fee_id: "fee1",
} } });
const refusal = (statusCode: number, extra: Record<string, unknown> = {}): Error => Object.assign(new Error("stripe"), { statusCode, ...extra });
const names = (): string[] => s.calls.map(c => c.fn);
beforeEach(() => { s.calls = []; s.attempt = null; create.mockReset(); });

it("bl43 #3 a resumed bill whose saved expiry Stripe now refuses gives back bill, coupon and fee, then lets the diner quote again", async () => {
  s.attempt = bill(minutesAgo(30));
  create.mockRejectedValueOnce(refusal(400, { type: "StripeInvalidRequestError", param: "expires_at" }));
  expect(await resumeDinerAttempt(stripe, "r", "bill:o")).toBeNull();
  expect(s.calls).toContainEqual({ fn: "finish_diner_checkout", args: { p_attempt: "attempt", p_paid: false } });
  expect(s.calls).toContainEqual({ fn: "release_platform_fee", args: { p_fee: "fee1" } });
});

it.each([
  ["a rate limit", refusal(429, { type: "StripeRateLimitError" })],
  ["a lock timeout", refusal(429, { type: "StripeRateLimitError", code: "lock_timeout" })],
  ["a key in use", refusal(409, { code: "idempotency_key_in_use" })],
  ["a server error", refusal(500)],
])("bl43 #2/#3 %s on resume keeps the reservation for the replay", async (_, error) => {
  s.attempt = bill(minutesAgo(30));
  create.mockRejectedValueOnce(error);
  await expect(resumeDinerAttempt(stripe, "r", "bill:o")).rejects.toBe(error);
  expect(names()).not.toContain("finish_diner_checkout");
  expect(names()).not.toContain("release_platform_fee");
});

it("bl43 #3 a refusal past Stripe's key window proves nothing, so the attempt stays reserved", async () => {
  s.attempt = bill(minutesAgo(24 * 60));
  create.mockRejectedValueOnce(refusal(400));
  await expect(resumeDinerAttempt(stripe, "r", "bill:o")).rejects.toThrow("stripe");
  expect(names()).not.toContain("finish_diner_checkout");
});

it("bl43 #2 a 429 while another request creates the split page keeps the share reserved", async () => {
  s.attempt = split();
  create.mockRejectedValueOnce(refusal(429, { type: "StripeRateLimitError", code: "lock_timeout" }));
  await expect(resumeDinerAttempt(stripe, "r", "split2:split:1:m:0")).rejects.toThrow("stripe");
  expect(names()).not.toContain("retire_split_attempt_v1");
});

it("bl43 #2 a split share Stripe refuses outright is retired and requoted", async () => {
  s.attempt = split();
  create.mockRejectedValueOnce(refusal(400));
  expect(await resumeDinerAttempt(stripe, "r", "split2:split:1:m:0")).toBeNull();
  expect(names()).toContain("retire_split_attempt_v1");
});
