import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCouponFormat, normalizeCoupon } from "@/lib/coupons";
import type { AppliedCoupon } from "@/lib/pricing";

// Server-side coupon lookup and eligibility. Shared by /api/coupons/validate
// and /api/checkout so the answer the customer is shown and the rule actually
// enforced at payment can never disagree.
//
// Always runs with the secret key: `coupons` has no anon grant at all, so a
// browser cannot read or enumerate codes even with a crafted request.

/** Why a coupon can't be used. Maps to a `coupon.<reason>` message key. */
export type CouponProblem =
  | "badFormat"
  | "notFound"
  | "expired"
  | "limitReached"
  | "minSubtotal";

export interface CouponRow {
  id: string;
  code: string;
  kind: "percent" | "fixed";
  value: number;
  min_subtotal: number;
  max_uses: number | null;
  uses_count: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
}

const COLUMNS =
  "id, code, kind, value, min_subtotal, max_uses, uses_count, active, starts_at, ends_at";

/** Looks up a coupon by code for one restaurant. Null when there's no match. */
export async function findCoupon(
  restaurantId: string,
  rawCode: string,
): Promise<CouponRow | null> {
  const code = normalizeCoupon(rawCode);
  if (!isValidCouponFormat(code)) return null;

  const { data } = await createAdminClient()
    .from("coupons")
    .select(COLUMNS)
    .eq("restaurant_id", restaurantId)
    .ilike("code", code) // codes are compared case-insensitively
    .maybeSingle();
  return (data as CouponRow | null) ?? null;
}

/**
 * Whether a coupon can be applied to a cart worth `subtotal`, or the reason it
 * can't. Mirrors the guards inside redeem_coupon() — this decides what the
 * customer is told, the SQL decides what actually happens.
 */
export function couponProblem(
  coupon: CouponRow,
  subtotal: number,
  now = new Date(),
): CouponProblem | null {
  if (!coupon.active) return "expired";
  if (coupon.starts_at && new Date(coupon.starts_at) > now) return "expired";
  if (coupon.ends_at && new Date(coupon.ends_at) <= now) return "expired";
  if (coupon.max_uses !== null && coupon.uses_count >= coupon.max_uses) {
    return "limitReached";
  }
  if (subtotal < Number(coupon.min_subtotal)) return "minSubtotal";
  return null;
}

/** The shape the pricing engine wants. */
export function toAppliedCoupon(coupon: CouponRow): AppliedCoupon {
  return {
    code: coupon.code,
    kind: coupon.kind,
    value: Number(coupon.value),
    minSubtotal: Number(coupon.min_subtotal),
  };
}

/**
 * Claims one use, atomically. Returns false when the coupon ran out between
 * validation and payment — the DB function, not this check, is what makes the
 * limit correct under concurrency.
 */
export async function claimCoupon(couponId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("redeem_coupon", {
    p_coupon_id: couponId,
  });
  return !error && typeof data === "number";
}

/** Hands a claimed use back when the checkout it was reserved for fell through. */
export async function releaseCoupon(couponId: string): Promise<void> {
  await createAdminClient().rpc("release_coupon", { p_coupon_id: couponId });
}

/**
 * Records a RESERVED use against an order. `confirmed_at` stays null until the
 * Stripe webhook reports the order paid — so an abandoned checkout leaves an
 * unconfirmed row that the expiry handler removes, rather than a phantom
 * redemption in the owner's records.
 */
export async function logRedemption(params: {
  restaurantId: string;
  couponId: string;
  orderId: string;
  code: string;
  amount: number;
}): Promise<void> {
  await createAdminClient().from("coupon_redemptions").insert({
    restaurant_id: params.restaurantId,
    coupon_id: params.couponId,
    order_id: params.orderId,
    code: params.code,
    amount: params.amount,
  });
}
