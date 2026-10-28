import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const s = vi.hoisted(() => ({ calls: [] as { name: string; args: unknown }[], outcome: "settled", error: false, finished: 0, feesReleased: 0 }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => {
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "is"]) q[op] = () => q;
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ count: 1, data: null, error: null }).then(resolve);
    q.single = q.maybeSingle = async () => ({ data: { id: "attempt", split_id: "split" }, error: null });
    return q;
  },
  rpc: async (name: string, args: unknown) => {
    s.calls.push({ name, args });
    return { data: { outcome: name === "retire_split_attempt_v1" ? "retired" : s.outcome }, error: s.error ? { message: "database unavailable" } : null };
  },
}) }));
vi.mock("@/lib/diner-checkout", () => ({ verifyDinerCheckout: async () => {}, requireVerifiedCheckout: () => {} }));
vi.mock("@/lib/diner-attempt", () => ({ finishDinerCheckout: async () => { s.finished++; } }));
vi.mock("@/lib/platform-fee", () => ({ takeFee: async () => {}, releaseSessionFee: async () => { s.feesReleased++; } }));
vi.mock("@/lib/table-session", () => ({ closeSessionsFor: async () => {} }));
const { settleCheckout, abandonCheckout } = await import("@/lib/checkout-settle");
const context = { account: "acct", livemode: false };
const session = { id: "cs", payment_status: "paid", payment_intent: "pi", amount_total: 11000,
  metadata: { restaurant_id: "r", split_id: "split", split_model: "2" } } as unknown as Stripe.Checkout.Session;
beforeEach(() => { s.calls = []; s.outcome = "settled"; s.error = false; s.finished = 0; s.feesReleased = 0; });
it.each(["settled", "duplicate", "refund_due"])("model 2 webhook records %s through the slot writer", async outcome => {
  s.outcome = outcome;
  await settleCheckout(session, context);
  expect(s.calls).toEqual([{ name: "settle_split_slots_v1", args: {
    p_restaurant: "r", p_checkout: "attempt", p_intent: "pi", p_charged_cents: 11000,
  } }]);
});
it.each(["gone", "invalid"])("model 2 webhook retries an unrecorded %s charge", async outcome => {
  s.outcome = outcome;
  await expect(settleCheckout(session, context)).rejects.toThrow();
});
it("model 2 webhook throws on a failed slot write", async () => {
  s.error = true;
  await expect(settleCheckout(session, context)).rejects.toThrow("database unavailable");
});
it("positive Stripe expiry retires the whole attempt once", async () => {
  await abandonCheckout({ ...session, payment_status: "unpaid", status: "expired" }, context);
  expect(s.calls).toEqual([{ name: "retire_split_attempt_v1", args: { p_restaurant: "r", p_checkout: "attempt" } }]);
  expect(s.finished).toBe(0); expect(s.feesReleased).toBe(0);
});
it("a paid checkout never releases slots", async () => {
  await expect(abandonCheckout(session, context)).rejects.toThrow();
  expect(s.calls).toEqual([]);
});
