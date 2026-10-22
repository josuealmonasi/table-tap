import { uncommittedRefusal } from "@/lib/retry-response";
import { orderRequestScope } from "@/lib/order-request";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { tableOf } from "@/lib/table-guard";
import { requestTableMember } from "@/lib/table-membership";
import { memberHash } from "@/lib/table-member-cookie";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/plan";
import { getPlan } from "@/lib/plan-server";
import { priceCart, type AppliedCoupon } from "@/lib/pricing";
import { releaseCoupon, toAppliedCoupon } from "@/lib/coupon-service";
import { isRoomLimited, isTableLimited } from "@/lib/rate-limit";
import { promotionsOnSale } from "@/lib/promotions-on-sale";
import { toCartPromos } from "@/lib/promotions";
import { MAX_CARD_CART_LINES } from "@/lib/stripe-limits";
import { raiseStockNotifications, releaseStock, reserveStock } from "@/lib/stock-service";
import { refuseCart, refuseShortStock } from "@/lib/checkout/cart-error";
import { orderableNow } from "@/lib/checkout/orderable-now";
import { claimCheckoutCoupon, logCheckoutCoupon } from "@/lib/checkout/claim-coupon";
import { checkoutLineItems } from "@/lib/checkout/line-items";
import { openCardSession } from "@/lib/checkout/card-session";
import { checkoutTip, type CheckoutBody } from "@/lib/checkout/checkout-body";
import { verifiedLines } from "@/lib/checkout/verified-lines";
import { checkoutOrderRow } from "@/lib/checkout/order-row";
import { payLaterAllowed } from "@/lib/checkout/pay-later";
import { checkoutFee } from "@/lib/checkout/app-fee";
import { NO_FEE, releaseFee, stripeRefusedOutright, type FeeHold } from "@/lib/platform-fee";
import { checkoutHold } from "@/lib/checkout/hold";
import { uuidOf } from "@/lib/costs/guard";
import { readOrderIntent, writeOrderIntent } from "@/lib/order-intent";
import { getLocale } from "@/lib/i18n/server";
import { siteOrigin } from "@/lib/site-origin";

export const runtime = "nodejs";

// POST /api/checkout — body: `CheckoutBody`.
// Creates a pending order, then a Stripe Checkout Session, and returns its URL.
// A pay-later order goes straight to the kitchen and returns no URL.
export async function POST(req: NextRequest) {
  const held = checkoutHold();
  try {
    // Throttle abusive callers before we create any orders or Stripe sessions:
    // the room behind this address first, then — once the body says which —
    // the table (`isRoomLimited`).
    if (await isRoomLimited(req, "checkout", 10)) {
      return await apiError("apiErr.tooManyAttempts", 429);
    }

    const body = await jsonBody<CheckoutBody>(req);
    if (!body) return await apiError("apiErr.invalidRequest", 400);
    const { restaurantId, tableId, items, couponCode, payLater } = body;
    if (await isTableLimited(req, "checkout", typeof tableId === "string" ? tableId : null, 10)) {
      return await apiError("apiErr.tooManyAttempts", 429);
    }
    const { tipPct, tipAmount } = checkoutTip(body);

    if (!restaurantId || !items?.length) {
      return await apiError("apiErr.orderData", 400);
    }

    const ref = uuidOf(body.ref);
    if (body.ref !== undefined && !ref) return await apiError("apiErr.invalidRequest", 400);
    const hash = memberHash(req);
    const surface = `checkout:${tableId ?? ""}:${hash ?? ""}`;
    const intent = payLater && ref ? { restaurantId, ref, scope: orderRequestScope(surface, body), legacyScope: surface } : null;
    if (intent) {
      const previous = await readOrderIntent(intent);
      if (previous?.conflict) return await apiError("apiErr.retryConflict", 409);
      if (previous) return NextResponse.json({ ...previous, deferred: true });
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

    // A retained table after a downgrade does not grant new table orders.
    // Existing bills use separate settlement routes and stay payable.
    if (tableId && (!plan || !can(plan.limits, "dineIn"))) {
      return await apiError("plan.needs.dineIn", 403, { plan: "Servicio" });
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
    const table = tableId ? await tableOf(restaurantId, tableId) : null;
    if (tableId && !table) {
      return await apiError("apiErr.tableNotFound", 404);
    }

    // Check an occupied table before reserving anything. Empty-table races
    // are decided under the table lock below, with any claims returned if
    // another phone opened the sitting while this cart was being checked.
    if (tableId && !hash) return await apiError("apiErr.tableJoin", 403);

    const waiting = tableId && hash ? await requestTableMember(restaurantId, tableId, hash) : null;
    if (waiting && (waiting.status === "pending" || waiting.status === "rejected")) {
      return await apiError("apiErr.tableJoin", 403);
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
    const claim = await claimCheckoutCoupon(restaurantId, couponCode, base.subtotal, !intent);
    if ("refused" in claim) return claim.refused;
    const coupon = claim.coupon;

    const pricing = coupon ? priceWith(toAppliedCoupon(coupon)) : base;

    /** Set once the stock is ours, so the undo below knows to hand it back. */
    let stockReservationId: string | null = null;
    /** Our fee, reserved under the month's ceiling: given back with the rest. */
    let fee: FeeHold = NO_FEE;
    /** Stripe's answer was unknown: the session may exist, so its fee stays counted. */
    let keepFee = false;

    /** Give back what this checkout reserved when it doesn't complete. */
    const undoClaim = async () => {
      if (coupon && !intent) await releaseCoupon(coupon.id);
      if (stockReservationId) await releaseStock(restaurantId, stockReservationId);
      if (!keepFee) await releaseFee(fee.id);
    };
    held.hold(undoClaim);

    fee = await checkoutFee(restaurantId, plan, deferred, pricing.subtotal);

    // Which sitting this order belongs to. A dine-in order needs admission;
    // a counter order has no table and no sitting.
    const admission = tableId && hash ? await requestTableMember(restaurantId, tableId, hash, true) : null;
    if (admission && admission.status !== "approved") {
      await held.giveBack();
      return await apiError("apiErr.tableJoin", 403);
    }
    const sessionId = admission?.sessionId ?? null;
    if (tableId && !sessionId) {
      await held.giveBack();
      return await apiError("apiErr.sessionGone", 409);
    }

    if (intent) {
      const result = await writeOrderIntent(intent, {
        order: checkoutOrderRow({
          restaurantId,
          table,
          sessionId,
          diner: admission?.diner ?? body.diner,
          deferred,
          pricing,
          taxPct: Number(restaurant.tax_pct) || 0,
          couponCode: coupon?.code ?? null,
          currency: restaurant.currency,
          verified,
          note: body.note,
          customerName: body.customerName,
        }),
        lines: verified, inventory: Boolean(plan && can(plan.limits, "inventory")),
        // The minimum spend is judged on the subtotal before the coupon, as
        // claimCheckoutCoupon judged it: the order's own subtotal is after it,
        // and a MX$10 coupon with a MX$100 minimum on MX$100 was refused.
        threshold: Number(restaurant.low_stock_threshold) || 0,
        coupon: coupon ? { ...coupon, eligible_subtotal: base.subtotal } : null,
      });
      if (result.conflict) return await apiError("apiErr.retryConflict", 409);
      if (result.couponReason) return NextResponse.json({ couponReason: result.couponReason, retryUncommitted: true }, { status: 409 });
      if (result.short) return await uncommittedRefusal(await refuseShortStock(result.short));
      held.handOver();
      if (!result.repeat && restaurant.low_stock_alerts_enabled) await raiseStockNotifications(restaurantId, result.low ?? []);
      return NextResponse.json({ orderId: result.orderId, sessionId: result.sessionId, deferred: true });
    }

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
      await held.giveBack();
      return await refuseShortStock(reservation.short);
    }
    stockReservationId = reservation.reservationId;

    // Create the pending order first so the webhook can find it.
    const { data: order, error: oErr } = await supabase
      .from("orders")
      .insert({
        stock_managed: true,
        stock_reservation_id: stockReservationId,
        ...checkoutOrderRow({
          restaurantId,
          table,
          sessionId,
          diner: admission?.diner ?? body.diner,
          deferred,
          pricing,
          taxPct: Number(restaurant.tax_pct) || 0,
          couponCode: coupon?.code ?? null,
          currency: restaurant.currency,
          verified,
          note: body.note,
          customerName: body.customerName,
        }),
      })
      .select("id")
      .single();

    if (oErr || !order) {
      await held.giveBack();
      return await apiError("apiErr.orderCreate", 500);
    }
    // A pay-later order is the kitchen's now. A card order is still ours until
    // its session is open and its coupon written down: give it back, row and all.
    if (deferred) held.handOver();
    else
      held.hold(async () => {
        const { error } = await supabase.from("orders").delete().eq("id", order.id);
        if (error) throw new Error(`Could not remove failed checkout: ${error.message}`);
        await undoClaim();
      });

    // Only once the order is real: a warning about stock an order never took
    // would send someone to count a shelf that is still full. Off by default,
    // because a restaurant that tracks nothing would only get noise.
    if (restaurant.low_stock_alerts_enabled) {
      await raiseStockNotifications(restaurantId, reservation.low);
    }

    // Nothing to charge now: the order is with the kitchen and the table owes
    // for it. The bill screen picks it up from here.
    if (deferred) {
      // Write the redemption down before returning. This return sits well
      // above the one place that logged it, so a coupon spent on a pay-later
      // order counted against its limit — `uses_count` is incremented either
      // way — and then appeared in no record of what was given away. The
      // money was right and the paperwork was missing.
      await logCheckoutCoupon(restaurantId, coupon, order.id, pricing.couponDiscount, true);
      return NextResponse.json({ orderId: order.id, deferred: true, sessionId });
    }

    const origin = siteOrigin(req);
    const cur = restaurant.currency.toLowerCase();

    // The reservation must exist before a payment or expiry can arrive. The
    // durable checkout binds it before exposing Stripe's page.
    await logCheckoutCoupon(restaurantId, coupon, order.id, pricing.couponDiscount);
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
          locale: await getLocale(),
          tipPct: tipAmount !== null ? 0 : tipPct,
        }),
        amountCents: Math.round(pricing.total * 100),
        amountOffCents: Math.round((pricing.couponDiscount + pricing.promoDiscount) * 100),
        couponCode: coupon?.code ?? null,
        currency: cur,
        origin,
        orderId: order.id,
        restaurantId,
        tableId,
        fee,
      });
    } catch (err) {
      // Stripe refused the session — the pending order will never be paid, so
      // remove it instead of leaving an orphan row, and give back the coupon
      // use we reserved. A failure that is not a refusal may have made the
      // session after all: its fee stays reserved until Stripe's expiry.
      keepFee = !stripeRefusedOutright(err);
      await held.giveBack();
      const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
      if (code === "amount_too_small") {
        return await apiError("apiErr.belowCardMinimum", 400);
      }
      throw err; // anything else falls through to the generic handler below
    }

    // The use is committed now that there's a real session to pay for, and
    // from here Stripe's expiry gives back whatever an unpaid session holds.
    held.handOver();

    await supabase
      .from("orders")
      .update({ stripe_session_id: session.id })
      .eq("id", order.id);

    return NextResponse.json({ url: session.url, orderId: order.id, sessionId });
  } catch (err) {
    console.error("checkout error", err);
    await held.giveBack();
    return await apiError("apiErr.checkoutFailed", 500);
  }
}
