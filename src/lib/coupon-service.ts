import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCouponFormat, normalizeCoupon } from "@/lib/coupons";
import { can, type PlanLimits } from "@/lib/plan";
import { getPlan } from "@/lib/plan-server";
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
  /** Applied by the floor, never typed by a diner. */
  staff_only: boolean;
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
  "id, code, kind, value, min_subtotal, max_uses, uses_count, active, starts_at, ends_at, staff_only";

/**
 * Whether the restaurant's tier carries this kind of code: coupons for the
 * ones a diner types, staff discounts for the ones the floor applies.
 *
 * Only creating a coupon used to ask. Codes saved on Casa went on discounting
 * at checkout and on the bill after a move to Servicio or Carta, while the
 * owner's screen said coupons come with Casa and the terms say a paid plan's
 * features stop with it. The codes are kept as they are, and work again back
 * on a tier that has them.
 */
export function couponInPlan(limits: PlanLimits | null | undefined, coupon: Pick<CouponRow, "staff_only">): boolean {
  return Boolean(limits) && can(limits!, coupon.staff_only ? "staffDiscounts" : "coupons");
}

/**
 * Looks up a coupon by code for one restaurant. Null when there's no match,
 * and when the restaurant's tier does not carry it (`couponInPlan`).
 *
 * A read that failed throws. It used to be "no match": in a blip the diner was
 * told a code printed on the restaurant's own flyer does not exist, took it
 * off and paid full price, and the floor was refused a discount it had just
 * been offered.
 */
export async function findCoupon(
  restaurantId: string,
  rawCode: string,
): Promise<CouponRow | null> {
  const code = normalizeCoupon(rawCode);
  if (!isValidCouponFormat(code)) return null;

  const [{ data, error }, plan] = await Promise.all([
    createAdminClient()
      .from("coupons")
      .select(COLUMNS)
      .eq("restaurant_id", restaurantId)
      .ilike("code", code) // codes are compared case-insensitively
      .maybeSingle(),
    getPlan(restaurantId),
  ]);
  if (error) throw new Error(`Could not look up the coupon: ${error.message}`);
  const coupon = (data as CouponRow | null) ?? null;
  return coupon && couponInPlan(plan?.limits, coupon) ? coupon : null;
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
 * Records a use against an order.
 *
 * `confirmed_at` stays null until the Stripe webhook reports the order paid —
 * so an abandoned checkout leaves an unconfirmed row that the expiry handler
 * removes, rather than a phantom redemption in the owner's records.
 *
 * `settled` writes it confirmed instead, for an order that has no Stripe
 * session to wait on. A table paying at the end is the case: the discount is
 * committed the moment the order is placed, the kitchen is already cooking it,
 * and there is no in-flight state that could be abandoned. Left unconfirmed it
 * would sit that way for ever, because the till collects it in cash and the
 * webhook that confirms is one it never reaches.
 */
export async function logRedemption(params: {
  restaurantId: string;
  couponId: string;
  orderId: string;
  code: string;
  amount: number;
  settled?: boolean;
}): Promise<void> {
  await createAdminClient().from("coupon_redemptions").insert({
    restaurant_id: params.restaurantId,
    coupon_id: params.couponId,
    order_id: params.orderId,
    code: params.code,
    amount: params.amount,
    confirmed_at: params.settled ? new Date().toISOString() : null,
  });
}
