import { NextRequest, NextResponse } from "next/server";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { isValidCouponFormat, normalizeCoupon } from "@/lib/coupons";
import { couponProblem, findCoupon } from "@/lib/coupon-service";

export const runtime = "nodejs";

// POST /api/coupons/validate — a customer checks a code before paying.
// Body: { restaurantId, code, subtotal }
//
// Deliberately narrow: it answers only "is THIS code usable", never lists or
// hints at other codes. Rate-limited because the code space is small enough to
// guess at otherwise.
export async function POST(req: NextRequest) {
  if (await isRateLimited(`coupon:${clientIp(req)}`, 10, 60)) {
    return NextResponse.json({ valid: false, reason: "tooMany" }, { status: 429 });
  }

  const { restaurantId, code, subtotal } = await req.json();
  if (!restaurantId || typeof code !== "string") {
    return NextResponse.json({ valid: false, reason: "notFound" }, { status: 400 });
  }

  const normalized = normalizeCoupon(code);
  if (!isValidCouponFormat(normalized)) {
    return NextResponse.json({ valid: false, reason: "badFormat" });
  }

  const coupon = await findCoupon(restaurantId, normalized);
  if (!coupon) {
    return NextResponse.json({ valid: false, reason: "notFound" });
  }

  const problem = couponProblem(coupon, Number(subtotal) || 0);
  if (problem) {
    // minSubtotal is the one refusal worth being specific about — the customer
    // can act on it by adding more to the order.
    return NextResponse.json({
      valid: false,
      reason: problem,
      ...(problem === "minSubtotal" ? { minSubtotal: Number(coupon.min_subtotal) } : {}),
    });
  }

  // Only what the cart needs to preview the discount. The real figure is
  // recomputed server-side at checkout regardless of what the client does here.
  return NextResponse.json({
    valid: true,
    code: coupon.code,
    kind: coupon.kind,
    value: Number(coupon.value),
    minSubtotal: Number(coupon.min_subtotal),
  });
}
