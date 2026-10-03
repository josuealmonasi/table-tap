import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import {
  claimCoupon,
  couponProblem,
  findCoupon,
  type CouponRow,
} from "@/lib/coupon-service";

/**
 * The coupon a checkout asked for, checked against the database and its use
 * reserved — or the answer that refuses it.
 *
 * The code is re-checked here from the DB: a client that skipped or faked
 * /validate gets no advantage, and the claim is what enforces the usage cap
 * under concurrency. If anything after this fails, the caller hands the use
 * back with `releaseCoupon`.
 */
export async function claimCheckoutCoupon(
  restaurantId: string,
  couponCode: unknown,
  /** What the minimum-spend rule is judged against: the subtotal without the coupon. */
  subtotal: number,
): Promise<{ coupon: CouponRow | null } | { refused: NextResponse }> {
  if (!(typeof couponCode === "string" && couponCode.trim())) return { coupon: null };
  // A failed lookup keeps the coupon in the cart (a `couponReason` drops it):
  // the code may be perfectly good, so the diner is asked to retry.
  const found = await findCoupon(restaurantId, couponCode).catch(() => undefined);
  if (found === undefined)
    return { refused: await apiError("apiErr.couponLookupFailed", 503) };
  if (!found)
    return { refused: NextResponse.json({ couponReason: "notFound" }, { status: 409 }) };
  // Same rule as the validate endpoint: a floor-only code is not a code a
  // customer can spend, however they got hold of it.
  if (found.staff_only) return { refused: await apiError("apiErr.couponNotFound", 400) };

  const problem = couponProblem(found, subtotal);
  if (problem)
    return { refused: NextResponse.json({ couponReason: problem }, { status: 409 }) };
  // Reserve the use now.
  if (!(await claimCoupon(found.id))) {
    return {
      refused: NextResponse.json({ couponReason: "limitReached" }, { status: 409 }),
    };
  }
  return { coupon: found };
}
