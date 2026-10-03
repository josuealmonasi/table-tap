import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { tableOf } from "@/lib/table-guard";
import { openSession } from "@/lib/table-session";
import { capName, capNote } from "@/lib/notes";
import { createAdminClient } from "@/lib/supabase/admin";
import { can, orderFeeCents, type PlanLimits } from "@/lib/plan";
import { getPlan } from "@/lib/plan-server";
import { feesTakenThisMonth } from "@/lib/fee-month";
import { priceCart, type AppliedCoupon } from "@/lib/pricing";
import { logRedemption, releaseCoupon, toAppliedCoupon } from "@/lib/coupon-service";
import { isRoomLimited, isTableLimited } from "@/lib/rate-limit";
import { promotionsOnSale } from "@/lib/promotions-on-sale";
import { toCartPromos } from "@/lib/promotions";
import { cartReferences, verifyCart, type VerifiableItem } from "@/lib/verify-cart";
import { MAX_CARD_CART_LINES } from "@/lib/stripe-limits";
import { rejectionMessage } from "@/lib/cart-rejection";
import { raiseStockNotifications, releaseStock, reserveStock } from "@/lib/stock-service";
import type { OrderLineItem } from "@/lib/types";
import { cartError } from "@/lib/checkout/cart-error";
import { orderableNow } from "@/lib/checkout/orderable-now";
import { claimCheckoutCoupon } from "@/lib/checkout/claim-coupon";
import { checkoutLineItems } from "@/lib/checkout/line-items";
import { openCardSession } from "@/lib/checkout/card-session";

export const runtime = "nodejs";

// POST /api/checkout
// Body: { restaurantId, tableId, tableLabel, items: OrderLineItem[], note }
// Creates a pending order, then a Stripe Checkout Session, and returns its URL.
/** A restaurant with no readable plan has no plan permissions. */
const NO_PLAN = { allows_deferred_payment: false } as PlanLimits;

export async function POST(req: NextRequest) {
  try {
    // Throttle abusive callers before we create any orders or Stripe sessions:
    // the room behind this address first, then — once the body says which —
    // the table (`isRoomLimited`).
    if (await isRoomLimited(req, "checkout", 10)) {
      return await apiError("apiErr.tooManyAttempts", 429);
    }

    const body = await jsonBody<Record<string, unknown>>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
    const {
      restaurantId,
      tableId,
      tableLabel,
      items,
      note,
      customerName,
      tipPct: rawTipPct,
      tipAmount: rawTipAmount,
      couponCode,
      payLater,
      diner,
    } = body as {
      restaurantId: string;
      tableId: string | null;
      tableLabel: string | null;
      items: OrderLineItem[];
      note?: string;
      /** Only sent from the general QR: at a table, the table is the name. */
      customerName?: string;
      tipPct?: number;
      tipAmount?: number;
      couponCode?: string;
      /** Dine-in: send the food now and settle at the end. */
      payLater?: boolean;
      /**
       * The throwaway id this phone gave itself for the evening.
       *
       * Stored on the order so a table can be divided between the people who
       * actually ate: the number of devices that have ordered on the sitting
       * is the most ways its bill can go. Absent from a waiter's order, and
       * from a phone with storage switched off.
       */
      diner?: string;
    };
    if (await isTableLimited(req, "checkout", typeof tableId === "string" ? tableId : null, 10)) {
      return await apiError("apiErr.tooManyAttempts", 429);
    }

    // Tips: either a preset percentage (recomputed from the verified subtotal)
    // or an exact "Other" amount — sanitised and capped below once the
    // subtotal is known.
    const tipPct = [0, 10, 15, 20].includes(rawTipPct ?? 0) ? (rawTipPct ?? 0) : 0;
    const tipAmount =
      Number.isFinite(rawTipAmount) && (rawTipAmount as number) > 0
        ? +(rawTipAmount as number).toFixed(2)
        : null;

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
    const planNow = await getPlan(restaurantId);
    if (planNow && !can(planNow.limits, "onlineOrdering")) {
      return await apiError("apiErr.orderAtRegister", 409);
    }

    // A menu switched off — or outside its opening hours — stops being
    // orderable, not just invisible (`orderableNow`).
    const { closedNow, onOpenMenu } = await orderableNow(supabase, restaurantId);
    if (closedNow) {
      return await apiError("apiErr.closedNow", 409);
    }

    // An unpaid order only leaves here if something holds it, and that is always
    // decided from the database, never from what the client says:
    //
    //   - at a table, the table holds it: the bill stays open and the waiter
    //     collects at the end, if the owner allows it;
    //   - on the general QR there is no table to come back to, so what holds it
    //     is the counter: the customer goes to the till, pays and collects.
    //
    // Without one of those two, anyone claiming `payLater` would walk off with
    // food nobody can charge for. Both come from the one switch the owner has:
    // which of them applies is decided by the QR, not by the restaurant.
    //
    // It also comes with the plan, and is asked here rather than only when the
    // switch is flipped: someone downgrading to Carta keeps the switch on in
    // the database, and without this would go on giving away orders with no
    // fee on the free plan.
    const allowDeferred =
      Boolean(restaurant.allow_pay_later) &&
      can((await getPlan(restaurantId))?.limits ?? NO_PLAN, "deferredPayment");
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

    // IMPORTANT: never trust client prices. Re-fetch every referenced item
    // (products AND extras) plus every combo component, so the verification
    // below can price them from the DB and check they're all still orderable.
    // Stripe Checkout takes 100 line items and this builds one per line,
    // plus the service charge and the tip.
    const refs = cartReferences(items, promotions, MAX_CARD_CART_LINES);
    if (!refs.ok) {
      const { key, vars } = rejectionMessage(refs.rejection);
      return await cartError(key, vars, 400, {});
    }
    const referencedIds = refs.ids;
    const { data: dbItems, error: iErr } = await supabase
      .from("menu_items")
      .select("id, name, price, emoji, available, discount_pct, modifiers, category_id, skips_kitchen")
      .in("id", referencedIds)
      .eq("restaurant_id", restaurantId);

    if (iErr || !dbItems) {
      return await apiError("apiErr.verifyItems", 400);
    }

    const result = verifyCart({
      items,
      promotions,
      dbItems: dbItems as VerifiableItem[],
      isOnOpenMenu: onOpenMenu,
      maxLines: MAX_CARD_CART_LINES,
    });
    if (!result.ok) {
      const r = result.rejection;
      // Vanished extras are the one refusal the cart can act on by itself: it
      // drops those lines and asks again, so it gets the ids rather than a
      // sentence. The wording of the rest lives in `rejectionMessage`.
      if (r.kind === "removedExtras") {
        return NextResponse.json(
          { removedExtraIds: r.ids, removedExtraNames: r.names },
          { status: 409 },
        );
      }
      const { key, vars } = rejectionMessage(r);
      const extra =
        r.kind === "unavailable"
          ? { unavailableItemId: r.itemId }
          : r.kind === "missingModifiers"
            ? { missingModifiers: r.unanswered, unansweredItemId: r.itemId }
            : {};
      return await cartError(key, vars, 400, extra);
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
    const { subtotal, serviceFee, tip, total } = pricing;
    const servicePct = restaurant.service_enabled ? restaurant.service_pct : 0;

    /** Set once the stock is ours, so the undo below knows to hand it back. */
    let stockReserved = false;

    /** Give back what this checkout reserved when it doesn't complete. */
    const undoClaim = async () => {
      if (coupon) await releaseCoupon(coupon.id);
      if (stockReserved) await releaseStock(restaurantId, verified);
    };

    // What we take from this order, worked out before the row is written so it
    // can be recorded on it — the ceiling for the month is summed from these.
    //
    // Capped against the food rather than the amount charged: the tip is the
    // diner's money on its way to the person who served them, and letting it
    // raise the ceiling means a generous table pays us more for the same small
    // order. A deferred order pays nothing here — it settles later, and the
    // fee is taken then.
    const feePlan = await getPlan(restaurantId);
    const takenThisMonth =
      feePlan?.limits.fee_cap && !deferred ? await feesTakenThisMonth(restaurantId) : 0;
    const appFee =
      feePlan && !deferred
        ? orderFeeCents(feePlan.limits, Math.round(subtotal * 100), takenThisMonth)
        : 0;

    // The table has to belong to this restaurant. Without this you can create an
    // order here with another venue's table, and the sitting it opens blocks the
    // one for their real diners.
    if (tableId && !(await tableOf(restaurantId, tableId))) {
      return await apiError("apiErr.tableNotFound", 404);
    }

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
      // Name the first dish that fell short and say how many there really are.
      // A bare "unavailable" would send them back to a cart that looks fine.
      const first = reservation.short[0];
      return await cartError(
        first ? "apiErr.onlyLeft" : "apiErr.stockGone",
        { name: first?.name ?? "", count: first?.available ?? 0 },
        409,
        {
          shortStock: reservation.short.map(s => ({
            itemId: s.itemId,
            available: s.available,
          })),
        },
      );
    }
    stockReserved = true;

    // Create the pending order first so the webhook can find it.
    const { data: order, error: oErr } = await supabase
      .from("orders")
      .insert({
        restaurant_id: restaurantId,
        table_id: tableId,
        table_label: tableLabel,
        session_id: sessionId,
        // Which phone this was. Bounded because it comes from the client and
        // is written with the secret key; anything longer is not one of ours.
        diner: typeof diner === "string" && diner.length > 0 && diner.length <= 64 ? diner : null,
        // A deferred order skips the payment gate and goes straight to the
        // pass: the kitchen starts cooking, `paid` stays false, and the table
        // settles at the end. `pending_payment` is what hides an order from the
        // board until Stripe confirms, which is exactly what must not happen
        // here.
        status: deferred ? "received" : "pending_payment",
        subtotal,
        service_fee: serviceFee,
        tip,
        tax_pct: Number(restaurant.tax_pct) || 0,
        discount: pricing.discount,
        platform_fee: appFee / 100,
        coupon_code: coupon?.code ?? null,
        // Where the discount came from, so the owner can tell a menu sale from
        // a quantity deal from a coupon when reviewing an order later.
        promo_detail:
          pricing.discount > 0
            ? {
                item: pricing.itemDiscount,
                promos: pricing.promoDiscount,
                coupon: pricing.couponDiscount,
              }
            : null,
        total,
        currency: restaurant.currency,
        items: verified,
        note: capNote(note) ?? null,
        // Ignored outright when there is a table. A name is how the counter
        // finds a person; a table already has one, and storing a name nobody
        // asked for would be collecting personal data for nothing.
        customer_name: tableId ? null : (capName(customerName) ?? null),
        paid: false,
      })
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

    // Nothing to charge now: the order is with the kitchen and the table owes
    // for it. The bill screen picks it up from here.
    if (deferred) {
      // Write the redemption down before returning. This return sits well
      // above the one place that logged it, so a coupon spent on a pay-later
      // order counted against its limit — `uses_count` is incremented either
      // way — and then appeared in no record of what was given away. The
      // money was right and the paperwork was missing.
      if (coupon) {
        await logRedemption({
          restaurantId,
          couponId: coupon.id,
          orderId: order.id,
          code: coupon.code,
          amount: pricing.couponDiscount,
          settled: true,
        });
      }
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
          serviceFee,
          servicePct,
          tip,
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
    if (coupon) {
      await logRedemption({
        restaurantId,
        couponId: coupon.id,
        orderId: order.id,
        code: coupon.code,
        amount: pricing.couponDiscount,
      });
    }

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
