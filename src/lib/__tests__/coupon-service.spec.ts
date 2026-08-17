import { describe, it, expect } from "vitest";
import { couponProblem, toAppliedCoupon, type CouponRow } from "@/lib/coupon-service";

function coupon(over: Partial<CouponRow> = {}): CouponRow {
  return {
    id: "c1",
    code: "GET-50X",
    kind: "percent",
    value: 50,
    min_subtotal: 0,
    staff_only: false,
    max_uses: null,
    uses_count: 0,
    active: true,
    starts_at: null,
    ends_at: null,
    ...over,
  };
}

const NOW = new Date("2026-08-03T12:00:00Z");

describe("couponProblem", () => {
  it("allows a plain live coupon", () => {
    expect(couponProblem(coupon(), 50, NOW)).toBeNull();
  });

  it("refuses a paused coupon", () => {
    expect(couponProblem(coupon({ active: false }), 50, NOW)).toBe("expired");
  });

  it("refuses one that hasn't started", () => {
    const c = coupon({ starts_at: "2026-09-01T00:00:00Z" });
    expect(couponProblem(c, 50, NOW)).toBe("expired");
  });

  it("refuses one that has ended", () => {
    const c = coupon({ ends_at: "2026-07-01T00:00:00Z" });
    expect(couponProblem(c, 50, NOW)).toBe("expired");
  });

  it("accepts one inside its window", () => {
    const c = coupon({ starts_at: "2026-08-01T00:00:00Z", ends_at: "2026-09-01T00:00:00Z" });
    expect(couponProblem(c, 50, NOW)).toBeNull();
  });

  it("refuses once the claim limit is reached — the 101st customer", () => {
    expect(couponProblem(coupon({ max_uses: 100, uses_count: 99 }), 50, NOW)).toBeNull();
    expect(couponProblem(coupon({ max_uses: 100, uses_count: 100 }), 50, NOW)).toBe(
      "limitReached",
    );
    // Defensive: an over-count (shouldn't happen) still refuses.
    expect(couponProblem(coupon({ max_uses: 100, uses_count: 101 }), 50, NOW)).toBe(
      "limitReached",
    );
  });

  it("treats a null limit as unlimited", () => {
    expect(couponProblem(coupon({ max_uses: null, uses_count: 9999 }), 50, NOW)).toBeNull();
  });

  it("refuses below the minimum spend, and allows exactly at it", () => {
    expect(couponProblem(coupon({ min_subtotal: 100 }), 99.99, NOW)).toBe("minSubtotal");
    expect(couponProblem(coupon({ min_subtotal: 100 }), 100, NOW)).toBeNull();
  });

  it("reports the limit before the minimum spend", () => {
    const c = coupon({ max_uses: 1, uses_count: 1, min_subtotal: 100 });
    expect(couponProblem(c, 1, NOW)).toBe("limitReached");
  });
});

describe("toAppliedCoupon", () => {
  it("coerces the numerics Postgres returns as strings", () => {
    const c = coupon({
      value: "25" as unknown as number,
      min_subtotal: "10" as unknown as number,
    });
    expect(toAppliedCoupon(c)).toEqual({
      code: "GET-50X",
      kind: "percent",
      value: 25,
      minSubtotal: 10,
    });
  });
});
