import { describe, it, expect } from "vitest";
import {
  COUPON_PATTERN,
  COUPON_PATTERN_HINT,
  COUPON_LENGTH,
  normalizeCoupon,
  isValidCouponFormat,
  generateCouponCode,
} from "@/lib/coupons";

describe("coupon format", () => {
  it("describes itself as XXX-XXX", () => {
    expect(COUPON_PATTERN_HINT).toBe("XXX-XXX");
    expect(COUPON_LENGTH).toBe(6);
  });

  it("accepts a well-formed code", () => {
    expect(COUPON_PATTERN.test("GET-50X")).toBe(true);
    expect(isValidCouponFormat("ABC-123")).toBe(true);
  });

  it("rejects the wrong shape", () => {
    for (const bad of ["GET50X", "GET-50", "GET-50XX", "GE-50X", "", "GET_50X"]) {
      expect(isValidCouponFormat(bad)).toBe(false);
    }
  });

  it("rejects lowercase and symbols (normalize first)", () => {
    expect(isValidCouponFormat("get-50x")).toBe(false);
  });
});

describe("normalizeCoupon", () => {
  it("upper-cases and re-inserts the separator", () => {
    expect(normalizeCoupon("get50x")).toBe("GET-50X");
    expect(normalizeCoupon("GET-50X")).toBe("GET-50X");
    expect(normalizeCoupon("  get 50 x ")).toBe("GET-50X");
  });

  it("treats a typed and an untyped separator as the same code", () => {
    expect(normalizeCoupon("abc123")).toBe(normalizeCoupon("ABC-123"));
  });

  it("strips stray punctuation", () => {
    expect(normalizeCoupon("a.b/c-1*2_3")).toBe("ABC-123");
  });

  it("keeps overflow so an over-long entry stays invalid", () => {
    const over = normalizeCoupon("ABC1234");
    expect(over).toBe("ABC-123-4");
    expect(isValidCouponFormat(over)).toBe(false);
  });

  it("leaves a short entry short (and therefore invalid)", () => {
    expect(normalizeCoupon("AB")).toBe("AB");
    expect(isValidCouponFormat(normalizeCoupon("AB"))).toBe(false);
  });
});

describe("generateCouponCode", () => {
  it("always produces a valid code", () => {
    for (let i = 0; i < 200; i++) {
      expect(isValidCouponFormat(generateCouponCode())).toBe(true);
    }
  });

  it("avoids the characters people misread (0/O, 1/I)", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCouponCode()).not.toMatch(/[01OI]/);
    }
  });
});
