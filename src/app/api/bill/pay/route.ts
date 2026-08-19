import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { apiError } from "@/lib/api-error";
import { billWindowStart } from "@/lib/table-bill";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { orderFeeCents } from "@/lib/plan";
import { getPlan } from "@/lib/plan-server";
import { feesTakenThisMonth } from "@/lib/fee-month";
import { applyCoupon } from "@/lib/pricing";
import {
  claimCoupon,
  couponProblem,
  findCoupon,
  logRedemption,
  releaseCoupon,
  toAppliedCoupon,
} from "@/lib/coupon-service";
import type { Order } from "@/lib/types";

export const runtime = "nodejs";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// POST /api/bill/pay
// Body: { restaurantId, tableId, orderIds: string[] }
//
// Settles orders that already exist and are already with the kitchen. The cart
// route can't do this: it prices a cart and creates an order, while this one
// charges for food that has been cooking for an hour.
//
// The amount is summed from the stored order rows, never from the request. A
// caller can choose WHICH of the table's orders to settle — that is the "pay
// mine / pay everything" choice — but not what they cost.
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRateLimited(`billpay:${clientIp(req)}`, 10, 60)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }

  const { restaurantId, tableId, orderIds, tipPct, tipAmount, couponCode } =
    (await req.json()) as {
      restaurantId?: string;
      tableId?: string;
      orderIds?: string[];
      tipPct?: number;
      tipAmount?: number;
      couponCode?: string;
    };
  if (!restaurantId || !tableId || !Array.isArray(orderIds) || orderIds.length === 0) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const db = createAdminClient();

  const { data: restaurant } = await db
    .from("restaurants")
    .select("id, name, currency, stripe_account_id, stripe_charges_enabled")
    .eq("id", restaurantId)
    .single();
  if (!restaurant) return await apiError("apiErr.restaurantNotFound", 404);
  if (!restaurant.stripe_account_id || !restaurant.stripe_charges_enabled) {
    return await apiError("apiErr.noCardPayments", 409);
  }

  // Scoped by restaurant AND table, so an id from somewhere else matches
  // nothing. Already-paid and cancelled rows are excluded here rather than
  // filtered afterwards: paying twice for the same food is the failure that
  // matters most.
  const { data: rows } = await db
    .from("orders")
    .select("id, total, currency, items, paid, status, coupon_code")
    .eq("restaurant_id", restaurantId)
    .eq("table_id", tableId)
    // Same window the diner's bill uses, so what is charged is what was shown.
    .gte("created_at", billWindowStart().toISOString())
    .eq("paid", false)
    .eq("written_off", false)
    .neq("status", "pending_payment")
    .neq("status", "cancelled")
    .in("id", orderIds);

  const orders = (rows ?? []) as (Pick<Order, "id" | "total" | "items"> & {
    coupon_code: string | null;
  })[];
  if (orders.length === 0) return await apiError("apiErr.billSettled", 409);

  const food = round2(orders.reduce((sum, o) => sum + Number(o.total), 0));


  // A coupon here discounts the share being settled, which is what lets two
  // people at one table each use their own on their own food. Two rules keep
  // it honest:
  //
  //   - an order that already carries a code was discounted when it was
  //     placed, and that discount is inside its total; a second one would take
  //     the same money off twice.
  //   - the code, its limits and the amount are all resolved here from the
  //     database. The request chooses which orders to settle, nothing more.
  let discount = 0;
  let coupon: Awaited<ReturnType<typeof findCoupon>> = null;
  if (typeof couponCode === "string" && couponCode.trim()) {
    if (orders.some(o => o.coupon_code)) {
      return await apiError("apiErr.couponAlreadyUsed", 409);
    }
    coupon = await findCoupon(restaurantId, couponCode);
    if (!coupon || coupon.staff_only) return await apiError("apiErr.couponNotFound", 400);
    if (couponProblem(coupon, food)) return await apiError("apiErr.couponNotValid", 400);

    // Reserve before charging. If the last use has gone, the diner is told now
    // rather than after their card has been taken.
    if (!(await claimCoupon(coupon.id))) {
      return await apiError("apiErr.couponNotValid", 409);
    }
    discount = applyCoupon(toAppliedCoupon(coupon), food);
  }

  const payable = round2(food - discount);

  // The tip is the one figure the diner sets, so it is clamped the same way the
  // cart clamps it: never negative, never more than the food it is thanking
  // somebody for. A percentage is recomputed here rather than trusted, so a
  // request cannot claim 15% and send a different number.
  // Tip follows the discounted amount, the same order the cart uses.
  const pct = Math.min(100, Math.max(0, Number(tipPct) || 0));
  const asked = tipAmount != null ? Number(tipAmount) : (payable * pct) / 100;
  const tip = Math.min(Math.max(0, round2(asked)), payable);

  const amount = round2(payable + tip);
  const cents = Math.round(amount * 100);
  // Our cut of this settlement, from the restaurant's tier. Settling a table
  // is one card payment for one bill, so it carries the same single fee an
  // order does rather than one per order on the bill — and it is capped
  // against the food rather than the amount charged, so a generous tip never
  // raises what we take.
  const feePlan = await getPlan(restaurantId);
  const takenThisMonth = feePlan?.limits.fee_cap
    ? await feesTakenThisMonth(restaurantId)
    : 0;
  const appFee = feePlan
    ? orderFeeCents(feePlan.limits, Math.round(payable * 100), takenThisMonth)
    : 0;
  if (cents <= 0) {
    if (coupon) await releaseCoupon(coupon.id);
    return await apiError("apiErr.billSettled", 409);
  }

  const origin = req.headers.get("origin") ?? new URL(req.url).origin;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: restaurant.currency.toLowerCase(),
              unit_amount: cents,
              // One line: the diner is settling a bill, not re-picking dishes,
              // and the itemised list is on the screen they came from.
              product_data: {
                name: `${restaurant.name} — ${orders.length} ${orders.length === 1 ? "order" : "orders"}`,
              },
            },
          },
        ],
        // The webhook marks exactly these rows paid. It is the only thing that
        // does: a returning browser proves nothing about whether money moved.
        metadata: {
          settle_order_ids: orders.map(o => o.id).join(","),
          // Recorded so the takings show what was actually collected. It lands
          // on one of the settled orders rather than being split across them:
          // a tip is for the table's service, not attributable to a dish.
          settle_tip: String(tip),
          settle_coupon: coupon?.code ?? "",
          settle_discount: String(discount),
          // Recorded on the settled order once Stripe confirms, so the monthly
          // ceiling is summed from what was actually taken.
          settle_fee: String(appFee / 100),
        },
        payment_intent_data: {
          application_fee_amount: appFee,
        },
        success_url: `${origin}/r/${restaurantId}/t/${tableId}?settled=1`,
        cancel_url: `${origin}/r/${restaurantId}/t/${tableId}?cancelled=1`,
      },
      { stripeAccount: restaurant.stripe_account_id },
    );

    // Reserved, not yet real: the webhook confirms it when the money lands,
    // and the expiry handler gives it back if the diner walks away from Stripe.
    // Attached to the first settled order, the same row that carries the tip.
    if (coupon) {
      await logRedemption({
        restaurantId,
        couponId: coupon.id,
        orderId: orders[0].id,
        code: coupon.code,
        amount: discount,
      });
    }

    return NextResponse.json({ url: session.url });
  } catch {
    // The charge never happened, so the reserved use goes back.
    if (coupon) await releaseCoupon(coupon.id);
    return await apiError("apiErr.checkoutFailed", 502);
  }
}
