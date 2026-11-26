import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { isValidCouponFormat, normalizeCoupon } from "@/lib/coupons";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { couponInPlan, couponProblem, type CouponRow } from "@/lib/coupon-service";
import { getPlan } from "@/lib/plan-server";
import { applyCoupon } from "@/lib/pricing";
import { couponBase } from "@/lib/coupon-base";
import { readDiscountableBill } from "@/lib/discount-bill";

export const runtime = "nodejs";

/**
 * GET /api/bill/discount/options?tableId=…&currency=… (or ?orderId=…) — the
 * promotions this bill can take.
 *
 * The floor was expected to remember codes, or leave the bill and go and read
 * the promotions page. They are the restaurant's own codes and the manager is
 * standing at a table, so the list comes to them — already filtered to what
 * would actually apply to the amount in front of them, because offering a
 * code that the bill is too small for is worse than not offering it.
 *
 * The bill is read here, with the apply route's own reader and base (the
 * dishes, never service or tips), rather than taken as a figure from the
 * screen: the screen once sent the bill total with service and tips in it, so
 * a code was offered — and priced — on more than the apply route judges.
 *
 * Staff only. Customer-facing endpoints still answer "no such code" for these.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const params = req.nextUrl.searchParams;
  const tableId = params.get("tableId");
  const orderId = params.get("orderId");
  if (!tableId && !orderId) return await apiError("apiErr.invalidRequest", 400);

  const db = createAdminClient();
  const [{ data }, plan, orders] = await Promise.all([
    db
      .from("coupons")
      .select("id, code, kind, value, min_subtotal, max_uses, uses_count, active, starts_at, ends_at, staff_only")
      .eq("restaurant_id", actor.restaurantId)
      .eq("active", true)
      .order("code"),
    getPlan(actor.restaurantId),
    readDiscountableBill(db, actor.restaurantId, { tableId, orderId, currency: params.get("currency") }),
  ]);
  // A failed read is not an empty bill.
  if (!orders) return await apiError("apiErr.generic", 503);
  const total = couponBase(orders);

  const options = ((data ?? []) as CouponRow[])
    // Same rules the apply endpoint enforces, so nothing offered here can be
    // refused a second later — the format included, which findCoupon checks
    // before anything else. A code stored in another shape was offered with a
    // computed discount and then answered "coupon not found".
    .filter(coupon => isValidCouponFormat(normalizeCoupon(coupon.code)))
    .filter(coupon => couponInPlan(plan?.limits, coupon))
    .filter(coupon => !couponProblem(coupon, total))
    .map(coupon => ({
      code: coupon.code,
      kind: coupon.kind,
      value: Number(coupon.value),
      staffOnly: coupon.staff_only,
      /** What it would take off this bill, so the choice is concrete. */
      amount: applyCoupon(
        { code: coupon.code, kind: coupon.kind, value: Number(coupon.value) },
        total,
      ),
      remaining:
        coupon.max_uses === null ? null : Math.max(0, coupon.max_uses - coupon.uses_count),
    }));

  return NextResponse.json({ options });
}
