import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const state = vi.hoisted(() => ({ attempts: [] as Record<string, unknown>[], calls: [] as { fn: string; args: Record<string, unknown> }[], failOpen: "", verified: true }));
const record = vi.hoisted(() => vi.fn(async () => {}));
const release = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/diner-checkout", () => ({ recordDinerCheckout: record, stripeLiveMode: () => false,
  requireVerifiedCheckout: () => { if (!state.verified) throw new Error("provenance"); } }));
vi.mock("@/lib/platform-fee", () => ({ releaseFee: release, stripeRefusedOutright: (e: { statusCode?: number }) => e.statusCode === 400 }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (fn: string, args: Record<string, unknown>) => {
    state.calls.push({ fn, args });
    if (fn === "diner_checkout_open") {
      if (state.failOpen) return { error: { message: "failed", code: state.failOpen === "unknown" ? "" : state.failOpen }, data: null };
      const proposed = args.p_record as Record<string, unknown>;
      const existing = state.attempts.find(a => a.scope_key === proposed.scope_key);
      if (!existing) state.attempts.push(proposed);
      return { data: existing ?? proposed, error: null };
    }
    return { data: null, error: null };
  },
  from: () => {
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq"]) q[op] = () => q;
    q.single = q.maybeSingle = async () => ({ data: state.attempts[0] ?? null, error: null });
    return q;
  },
}) }));
const { openDinerAttempt, resumeDinerAttempt, finishDinerCheckout } = await import("@/lib/diner-attempt");
const params = { mode: "payment", metadata: { restaurant_id: "r", fee_id: "fee1" }, expires_at: 12345 } as Stripe.Checkout.SessionCreateParams;
const quote = { restaurantId: "r", stripeAccount: "acct", currency: "MXN", amountCents: 9000,
  orderIds: ["a"], payableIds: ["a"], scopeKey: "bill:a", entitlements: { a: 90 }, discounts: { a: 10 }, couponId: "coupon1", foodPrincipal: 90 };
const session = { id: "cs1", status: "open", url: "https://stripe.test/one" } as Stripe.Checkout.Session;
const create = vi.fn(async () => session);
const retrieve = vi.fn(async () => session);
const stripe = { checkout: { sessions: { create, retrieve, expire: vi.fn() } } } as unknown as Stripe;
beforeEach(() => {
  state.attempts = []; state.calls = []; state.failOpen = ""; state.verified = true;
  create.mockReset().mockResolvedValue(session); retrieve.mockReset().mockResolvedValue(session); record.mockClear(); release.mockClear();
});
it("E4 freezes net entitlements and the coupon in the attempt before asking Stripe", async () => {
  await openDinerAttempt(stripe, params, quote);
  expect(state.calls[0]).toMatchObject({ fn: "diner_checkout_open", args: { p_record: {
    entitlements: { a: 90 }, order_discounts: { a: 10 }, coupon_id: "coupon1", amount_cents: 9000,
  } } });
  expect(create).toHaveBeenCalledWith(params, expect.objectContaining({ idempotencyKey: state.attempts[0].idempotency_key }));
  expect(record).toHaveBeenCalled();
});
it("E8 concurrent zero-fee requests share one persisted Stripe idempotency key", async () => {
  const free = { ...params, metadata: { restaurant_id: "r" } };
  const results = await Promise.all([openDinerAttempt(stripe, free, quote), openDinerAttempt(stripe, free, quote)]);
  expect(state.attempts).toHaveLength(1);
  expect(new Set(create.mock.calls.map(c => (c as unknown as [unknown, { idempotencyKey: string }])[1].idempotencyKey)).size).toBe(1);
  expect(results.map(s => s.url)).toEqual([session.url, session.url]);
});
it("E8 a lost Stripe response retries the same amount, expiry, tip and fee", async () => {
  create.mockRejectedValueOnce(new Error("connection lost"));
  await expect(openDinerAttempt(stripe, params, quote)).rejects.toThrow("lost");
  expect(state.calls.some(c => c.fn === "finish_diner_checkout")).toBe(false);
  await resumeDinerAttempt(stripe, "r", quote.scopeKey);
  expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
  expect(release).not.toHaveBeenCalled();
});
it("E8 reuses an open session without creating a second one", async () => {
  state.attempts = [{ id: "attempt", ...quote, stripe_session_id: "cs1" }];
  expect((await resumeDinerAttempt(stripe, "r", quote.scopeKey))?.url).toBe(session.url);
  expect(create).not.toHaveBeenCalled();
  expect(retrieve).toHaveBeenCalled();
});
it.each([false, true])("E7 expiry and confirmation target only the verified attempt (%s)", async paid => {
  state.attempts = [{ id: "attempt-a" }];
  await finishDinerCheckout(session, paid);
  expect(state.calls).toEqual([{ fn: "finish_diner_checkout", args: { p_attempt: "attempt-a", p_paid: paid } }]);
});
it("E7 an unverified event cannot release a coupon", async () => {
  state.verified = false;
  await expect(finishDinerCheckout(session, false)).rejects.toThrow("provenance");
  expect(state.calls).toEqual([]);
});
it("an uncertain database commit keeps its fee counted", async () => {
  state.failOpen = "unknown";
  await expect(openDinerAttempt(stripe, params, quote)).rejects.toThrow("failed");
  expect(create).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
});
it("a SQL refusal gives back only the losing request's fee", async () => {
  state.failOpen = "P0001";
  await expect(openDinerAttempt(stripe, params, quote)).rejects.toThrow("failed");
  expect(release).toHaveBeenCalledWith("fee1");
  expect(create).not.toHaveBeenCalled();
});
it("a database connection error does not prove rollback", async () => {
  state.failOpen = "08006";
  await expect(openDinerAttempt(stripe, params, quote)).rejects.toThrow("failed");
  expect(release).not.toHaveBeenCalled();
});
it("E8 a confirmed expiry lets this request quote the bill again", async () => {
  state.attempts = [{ id: "attempt", stripe_session_id: "cs1" }];
  retrieve.mockResolvedValueOnce({ ...session, status: "expired", url: null });
  expect(await resumeDinerAttempt(stripe, "r", quote.scopeKey)).toBeNull();
  expect(state.calls).toContainEqual({ fn: "finish_diner_checkout", args: { p_attempt: "attempt", p_paid: false } });
});
it("E8 a retry never refreshes an uncertain attempt's frozen expiry", async () => {
  state.attempts = [{ id: "attempt", stripe_session_id: null, stripe_params: { expires_at: 1 } }];
  create.mockRejectedValueOnce(new Error("connection lost"));
  await expect(resumeDinerAttempt(stripe, "r", quote.scopeKey)).rejects.toThrow("lost");
  expect(create).toHaveBeenCalledWith({ expires_at: 1 }, expect.anything());
  expect(state.calls).toEqual([]);
});
it("E8 an outright initial Stripe refusal closes only its own attempt", async () => {
  create.mockRejectedValueOnce({ statusCode: 400 });
  await expect(openDinerAttempt(stripe, params, quote)).rejects.toBeDefined();
  expect(state.calls).toContainEqual({ fn: "finish_diner_checkout", args: { p_attempt: state.attempts[0].id, p_paid: false } });
});
it("E8 a refusal while reusing an uncertain attempt never releases its coupon or fee", async () => {
  state.attempts = [{ id: "older", scope_key: quote.scopeKey, stripe_session_id: null,
    stripe_params: params, idempotency_key: "persisted" }];
  create.mockRejectedValueOnce({ statusCode: 400 });
  await expect(openDinerAttempt(stripe, params, quote)).rejects.toBeDefined();
  expect(state.calls.some(c => c.fn === "finish_diner_checkout")).toBe(false);
});
