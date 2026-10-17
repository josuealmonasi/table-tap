import { beforeEach, describe, expect, it, vi } from "vitest";

/** A database that answers each table's read with what the test planted, and records rpc calls. */
const answers: Record<string, { data: unknown; error: { message: string } | null }> = {};
const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
const chain = (table: string): unknown => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "order", "limit", "update"]) q[m] = () => q;
  q.maybeSingle = async () => answers[table] ?? { data: null, error: null };
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve(answers[table] ?? { data: null, error: null }).then(ok);
  return q;
};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => chain(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return { data: fn === "take_platform_fee" ? false : true, error: null };
    },
  }),
}));

import { feeMetadata, retirePriorShareSession, stripeRefusedOutright, takeFee } from "@/lib/platform-fee";

beforeEach(() => {
  for (const k of Object.keys(answers)) delete answers[k];
  rpcs.length = 0;
});

// A reservation is released when its Stripe session was never made. Stripe
// says plainly when it made nothing (a 4xx); a dropped connection, a 5xx, or a
// 409 — the same idempotency key still being worked on — may still be a
// session, so the fee stays counted until Stripe's expiry releases it.
describe("when a failed Stripe call means no session was made", () => {
  it("is an outright refusal on a 4xx", () => {
    expect(stripeRefusedOutright({ type: "StripeInvalidRequestError", statusCode: 400 })).toBe(true);
    expect(stripeRefusedOutright({ type: "StripePermissionError", statusCode: 403 })).toBe(true);
    expect(stripeRefusedOutright({ type: "StripeRateLimitError", statusCode: 429 })).toBe(true);
  });

  it("is unknown on a 409, a 5xx, a dropped connection, or anything else", () => {
    expect(stripeRefusedOutright({ type: "StripeInvalidRequestError", statusCode: 409, code: "idempotency_key_in_use" })).toBe(false);
    expect(stripeRefusedOutright({ type: "StripeAPIError", statusCode: 500 })).toBe(false);
    expect(stripeRefusedOutright({ type: "StripeConnectionError" })).toBe(false);
    expect(stripeRefusedOutright(new Error("socket hang up"))).toBe(false);
    expect(stripeRefusedOutright(null)).toBe(false);
  });
});

describe("what a session carries about its fee", () => {
  it("names the reservation, its amount and the restaurant, so the webhook can record it even without the row", () => {
    expect(feeMetadata({ id: "fee-1", cents: 75 }, "r-1")).toEqual({ fee_id: "fee-1", fee_cents: "75", restaurant_id: "r-1" });
  });

  it("carries nothing when nothing is charged", () => {
    expect(feeMetadata({ id: null, cents: 0 }, "r-1")).toEqual({});
  });
});

describe("a fee recorded from the session when there is no reservation to take", () => {
  const session = (metadata: Record<string, string>) =>
    ({ id: "cs_1", payment_intent: "pi_1", amount_total: 3000, metadata }) as never;

  it("needs no read when the session carries its fee and restaurant", async () => {
    await takeFee(session({}), { feeId: "gone", feeCents: "75", restaurantId: "r-1" });
    expect(rpcs.at(-1)).toMatchObject({ fn: "record_session_fee", args: { p_restaurant: "r-1", p_cents: 75, p_ref: "session:cs_1" } });
  });

  it("records nothing for a session that carries no fee — a plan without one, or a ceiling reached", async () => {
    await takeFee(session({ order_id: "o-1" }), {});
    expect(rpcs.some(r => r.fn === "record_session_fee")).toBe(false);
  });
});

describe("a share reopened while its earlier session is still open", () => {
  const ok = (status: string) => async () => ({ status });

  it("does nothing when the share has no open fee", async () => {
    expect(await retirePriorShareSession("r-1", "split:s:1", ok("expired"), ok("open"))).toBe("none");
  });

  it("expires the earlier session and releases its fee before the new one takes it", async () => {
    answers.platform_fees = { data: { id: "fee-1", stripe_session_id: "cs_old" }, error: null };
    expect(await retirePriorShareSession("r-1", "split:s:1", ok("expired"), ok("open"))).toBe("retired");
    expect(rpcs.at(-1)).toMatchObject({ fn: "release_platform_fee", args: { p_fee: "fee-1" } });
  });

  it("says the share is paid when the earlier session already completed", async () => {
    answers.platform_fees = { data: { id: "fee-1", stripe_session_id: "cs_old" }, error: null };
    const refuse = async () => { throw new Error("not open"); };
    expect(await retirePriorShareSession("r-1", "split:s:1", refuse, ok("complete"))).toBe("paid");
    expect(rpcs.some(r => r.fn === "release_platform_fee")).toBe(false);
  });

  it("refuses when the earlier session's state is unknown, rather than open a second fee-bearing one", async () => {
    answers.platform_fees = { data: { id: "fee-1", stripe_session_id: "cs_old" }, error: null };
    const refuse = async () => { throw new Error("not open"); };
    await expect(retirePriorShareSession("r-1", "split:s:1", refuse, ok("open"))).rejects.toThrow(/open/);
  });
});
