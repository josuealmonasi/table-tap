import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { couponProblem, type CouponRow } from "@/lib/coupon-service";
import { applyCoupon } from "@/lib/pricing";

export const runtime = "nodejs";

/**
 * GET /api/bill/discount/options?total=… — the promotions this bill can take.
 *
 * The floor was expected to remember codes, or leave the bill and go and read
 * the promotions page. They are the restaurant's own codes and the manager is
 * standing at a table, so the list comes to them — already filtered to what
 * would actually apply to the amount in front of them, because offering a
 * code that the bill is too small for is worse than not offering it.
 *
 * Staff only. Customer-facing endpoints still answer "no such code" for these.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const total = Number(req.nextUrl.searchParams.get("total")) || 0;

  const { data } = await createAdminClient()
    .from("coupons")
    .select("id, code, kind, value, min_subtotal, max_uses, uses_count, active, starts_at, ends_at, staff_only")
    .eq("restaurant_id", actor.restaurantId)
    .eq("active", true)
    .order("code");

  const options = ((data ?? []) as CouponRow[])
    // Same rules the apply endpoint enforces, so nothing offered here can be
    // refused a second later.
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
