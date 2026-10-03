import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { tableOf } from "@/lib/table-guard";
import { openSession } from "@/lib/table-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/plan";
import { getPlan } from "@/lib/plan-server";
import { priceCart, type AppliedCoupon } from "@/lib/pricing";
import { logRedemption, releaseCoupon, toAppliedCoupon } from "@/lib/coupon-service";
import { isRoomLimited, isTableLimited } from "@/lib/rate-limit";
import { promotionsOnSale } from "@/lib/promotions-on-sale";
import { toCartPromos } from "@/lib/promotions";
import { MAX_CARD_CART_LINES } from "@/lib/stripe-limits";
import { raiseStockNotifications, releaseStock, reserveStock } from "@/lib/stock-service";
import { refuseCart, refuseShortStock } from "@/lib/checkout/cart-error";
import { orderableNow } from "@/lib/checkout/orderable-now";
import { claimCheckoutCoupon } from "@/lib/checkout/claim-coupon";
import { checkoutLineItems } from "@/lib/checkout/line-items";
import { openCardSession } from "@/lib/checkout/card-session";
import { checkoutTip, type CheckoutBody } from "@/lib/checkout/checkout-body";
import { verifiedLines } from "@/lib/checkout/verified-lines";
import { checkoutOrderRow } from "@/lib/checkout/order-row";
import { payLaterAllowed } from "@/lib/checkout/pay-later";
import { checkoutFeeCents } from "@/lib/checkout/app-fee";

export const runtime = "nodejs";

// POST /api/checkout — body: `CheckoutBody`.
// Creates a pending order, then a Stripe Checkout Session, and returns its URL.
// A pay-later order goes straight to the kitchen and returns no URL.
export async function POST(req: NextRequest) {
  try {
    // Throttle abusive callers before we create any orders or Stripe sessions:
    // the room behind this address first, then — once the body says which —
    // the table (`isRoomLimited`).
    if (await isRoomLimited(req, "checkout", 10)) {
      return await apiError("apiErr.tooManyAttempts", 429);
    }

    const body = await jsonBody<CheckoutBody>(req);
    if (!body) return await apiError("apiErr.invalidRequest", 400);
    const { restaurantId, tableId, tableLabel, items, couponCode, payLater } = body;
    if (await isTableLimited(req, "checkout", typeof tableId === "string" ? tableId : null, 10)) {
      return await apiError("apiErr.tooManyAttempts", 429);
    }
    const { tipPct, tipAmount } = checkoutTip(body);

    if (!restaurantId || !items?.length) {
      return await apiError("apiErr.orderData", 400);
    }

    const supabase = createAdminClient();

    // Re-fetch the restaurant to get the authoritative service % and currency.
    const { data: restaurant, error: rErr } = await supabase
      .from("restaurants")
      .select(
        "id, currency, service_pct, service_enabled, accepting_orders, tax_pct, stripe_account_id, stripe_charges_enabled, allow_pay_later, low_stock_alerts_enabled, low_stock_threshold",
      )
      .eq("id", restaurantId)
      .single();

    if (rErr || !restaurant) {
      return await apiError("apiErr.restaurantNotFound", 404);
    }

    // Kill switch: the owner paused orders (maybe after this page loaded).
    if (!restaurant.accepting_orders) {
      return await apiError("apiErr.notAccepting", 409);
    }

    // Caja takes the order at the register, never from the diner's phone. The
    // menu offers no way to check out there; this refuses a request that
    // asks anyway, with the same sentence the menu shows.
    const plan = await getPlan(restaurantId);
    if (plan && !can(plan.limits, "onlineOrdering")) {
      return await apiError("apiErr.orderAtRegister", 409);
    }

    // A menu switched off — or outside its opening hours — stops being
    // orderable, not just invisible (`orderableNow`).
    const { closedNow, onOpenMenu } = await orderableNow(supabase, restaurantId);
    if (closedNow) {
      return await apiError("apiErr.closedNow", 409);
    }

    // The table must belong to this restaurant, or the sitting it opens blocks
    // another venue's diners. Asked before anything is reserved: after the
    // coupon claim, this answer once kept a use nobody spent.
    if (tableId && !(await tableOf(restaurantId, tableId))) {
      return await apiError("apiErr.tableNotFound", 404);
    }

    // Pay later is decided from the database and the plan (`payLaterAllowed`).
    const allowDeferred = payLaterAllowed(restaurant.allow_pay_later, plan?.limits);
    const deferred = Boolean(payLater) && allowDeferred;
    if (payLater && !deferred) {
      return await apiError("apiErr.payLaterNotAllowed", 403);
    }

    // No payouts without a connected Stripe account: refuse to charge a card
    // when we'd have nowhere to send the money. The owner completes onboarding
    // in Settings → Payments before customers can check out. A deferred order
    // takes no card here, so it is exempt — the waiter settles it later.
    if (!deferred && (!restaurant.stripe_account_id || !restaurant.stripe_charges_enabled)) {
      return await apiError("apiErr.noCardPayments", 409);
    }

    // Promotions come from the DB too, so a combo's price and a quantity deal's
    // terms are never the client's to decide.
    const promotions = await promotionsOnSale(supabase, restaurantId, {
      activeOnly: true,
    });
    const cartPromos = toCartPromos(promotions);

    // Stripe Checkout takes 100 line items and this builds one per line, plus
    // the service charge and the tip.
    const result = await verifiedLines(supabase, restaurantId, {
      items,
      promotions,
      onOpenMenu,
      maxLines: MAX_CARD_CART_LINES,
    });
    if (!result.ok) {
      if (!result.rejection) return await apiError("apiErr.verifyItems", 400);
      return await refuseCart(result.rejection);
    }
    const verified = result.lines;

    // THE authoritative price. Same function the customer's cart ran, but fed
    // DB-verified prices — so the amount charged is never the client's opinion.
    // It also caps an exact tip at the subtotal (guards fat fingers and abuse).
    const priceWith = (coupon: AppliedCoupon | null) =>
      priceCart({
        items: verified,
        servicePct: restaurant.service_pct,
        serviceEnabled: restaurant.service_enabled,
        tipPct,
        tipAmount,
        coupon,
        promos: cartPromos,
      });

    // Price once without the coupon: that subtotal is what its minimum-spend
    // rule is judged against.
    const base = priceWith(null);

    // The code is re-checked here from the DB, and its use reserved
    // (`claimCheckoutCoupon`); a refusal is answered as it is.
    const claim = await claimCheckoutCoupon(restaurantId, couponCode, base.subtotal);
    if ("refused" in claim) return claim.refused;
    const coupon = claim.coupon;

    const pricing = coupon ? priceWith(toAppliedCoupon(coupon)) : base;

    /** Set once the stock is ours, so the undo below knows to hand it back. */
    let stockReserved = false;

    /** Give back what this checkout reserved when it doesn't complete. */
    const undoClaim = async () => {
      if (coupon) await releaseCoupon(coupon.id);
      if (stockReserved) await releaseStock(restaurantId, verified);
    };

    const appFee = await checkoutFeeCents(restaurantId, plan, deferred, pricing.subtotal);

    // Which sitting this order belongs to. A dine-in order joins whoever is
    // already at the table; a counter order has no table and no sitting.
    const sessionId = tableId ? await openSession(restaurantId, tableId) : null;

    // Take the stock this order needs before asking anyone for money.
    //
    // Counting down only once the payment lands would let two tables each be
    // sold the last portion while both sit on a Stripe page — so the count
    // moves here, and the webhook's abandon handler gives it back when the
    // payment never happens.
    const reservation = await reserveStock(
      restaurantId,
      verified,
      Number(restaurant.low_stock_threshold) || 0,
    );
    if (!reservation.ok) {
      await undoClaim();
      return await refuseShortStock(reservation.short);
    }
    stockReserved = true;

    // Create the pending order first so the webhook can find it.
    const { data: order, error: oErr } = await supabase
      .from("orders")
      .insert(
        checkoutOrderRow({
          restaurantId,
          tableId,
          tableLabel,
          sessionId,
          diner: body.diner,
          deferred,
          pricing,
          taxPct: Number(restaurant.tax_pct) || 0,
          appFeeCents: appFee,
          couponCode: coupon?.code ?? null,
          currency: restaurant.currency,
          verified,
          note: body.note,
          customerName: body.customerName,
        }),
      )
      .select("id")
      .single();

    if (oErr || !order) {
      await undoClaim();
      return await apiError("apiErr.orderCreate", 500);
    }

    // Only once the order is real: a warning about stock an order never took
    // would send someone to count a shelf that is still full. Off by default,
    // because a restaurant that tracks nothing would only get noise.
    if (restaurant.low_stock_alerts_enabled) {
      await raiseStockNotifications(restaurantId, reservation.low);
    }

    /** Writes the coupon's use down against this order. */
    const logCoupon = async (extra: { settled?: true } = {}) => {
      if (!coupon) return;
      await logRedemption({
        restaurantId,
        couponId: coupon.id,
        orderId: order.id,
        code: coupon.code,
        amount: pricing.couponDiscount,
        ...extra,
      });
    };

    // Nothing to charge now: the order is with the kitchen and the table owes
    // for it. The bill screen picks it up from here.
    if (deferred) {
      // Write the redemption down before returning. This return sits well
      // above the one place that logged it, so a coupon spent on a pay-later
      // order counted against its limit — `uses_count` is incremented either
      // way — and then appeared in no record of what was given away. The
      // money was right and the paperwork was missing.
      await logCoupon({ settled: true });
      return NextResponse.json({ orderId: order.id, deferred: true, sessionId });
    }

    const origin = req.headers.get("origin") ?? new URL(req.url).origin;
    const cur = restaurant.currency.toLowerCase();

    let session;
    try {
      session = await openCardSession({
        stripeAccount: restaurant.stripe_account_id,
        lineItems: checkoutLineItems({
          verified,
          currency: cur,
          serviceFee: pricing.serviceFee,
          servicePct: restaurant.service_enabled ? restaurant.service_pct : 0,
          tip: pricing.tip,
          tipLabel: tipAmount !== null ? "Tip" : `Tip (${tipPct}%)`,
        }),
        amountOffCents: Math.round((pricing.couponDiscount + pricing.promoDiscount) * 100),
        couponCode: coupon?.code ?? null,
        currency: cur,
        origin,
        orderId: order.id,
        restaurantId,
        tableId,
        appFee,
      });
    } catch (err) {
      // Stripe refused the session — the pending order will never be paid, so
      // remove it instead of leaving an orphan row, and give back the coupon
      // use we reserved.
      await supabase.from("orders").delete().eq("id", order.id);
      await undoClaim();
      const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
      if (code === "amount_too_small") {
        return await apiError("apiErr.belowCardMinimum", 400);
      }
      throw err; // anything else falls through to the generic handler below
    }

    // The use is committed now that there's a real session to pay for.
    await logCoupon();

    await supabase
      .from("orders")
      .update({ stripe_session_id: session.id })
      .eq("id", order.id);

    return NextResponse.json({ url: session.url, orderId: order.id, sessionId });
  } catch (err) {
    console.error("checkout error", err);
    return await apiError("apiErr.checkoutFailed", 500);
  }
}
