import type { Coupon } from "@/hooks/useCoupons";

export type CouponFilter = "all" | "active" | "expired" | "paused";

/** Mirrors couponProblem's date guards, with paused codes in their own view.
 * Exhausted uses and minimum spend are separate server refusal reasons. */
export function couponStatus(coupon: Coupon, now: number): Exclude<CouponFilter, "all"> {
  if (!coupon.active) return "paused";
  if ((coupon.starts_at && new Date(coupon.starts_at).getTime() > now)
    || (coupon.ends_at && new Date(coupon.ends_at).getTime() <= now)) return "expired";
  return "active";
}
