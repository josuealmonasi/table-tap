import { describe, expect, it } from "vitest";
import { feeMetadata, stripeRefusedOutright } from "@/lib/platform-fee";

// A reservation is released when its Stripe session was never made. Stripe
// says plainly when it made nothing (a 4xx); a dropped connection or a 5xx is
// indeterminate — the session may exist and be paid — so the fee stays
// counted until Stripe's expiry releases it. Releasing on those let a second
// checkout take the same room under the month's ceiling.
describe("when a failed Stripe call means no session was made", () => {
  it("is an outright refusal on a 4xx", () => {
    expect(stripeRefusedOutright({ type: "StripeInvalidRequestError", statusCode: 400 })).toBe(true);
    expect(stripeRefusedOutright({ type: "StripePermissionError", statusCode: 403 })).toBe(true);
    expect(stripeRefusedOutright({ type: "StripeRateLimitError", statusCode: 429 })).toBe(true);
  });

  it("is unknown on a 5xx, a dropped connection, or anything else", () => {
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
