import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return { data: fn === "take_platform_fee" ? false : true, error: null };
    },
  }),
}));

import { feeMetadata, stripeRefusedOutright, takeFee } from "@/lib/platform-fee";

beforeEach(() => {
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
