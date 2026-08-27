import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { tableOf } from "@/lib/table-guard";
import { openSession } from "@/lib/table-session";
import { capNote } from "@/lib/notes";
import { messagesFor, translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { DEFAULT_TIME_ZONE, openMenuIds, type MenuOpenState } from "@/lib/open-menus";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { can, orderFeeCents, type PlanLimits } from "@/lib/plan";
import { getPlan } from "@/lib/plan-server";
import { feesTakenThisMonth } from "@/lib/fee-month";
import { itemSalePrice, priceCart, type AppliedCoupon } from "@/lib/pricing";
import {
  claimCoupon,
  couponProblem,
  findCoupon,
  logRedemption,
  releaseCoupon,
  toAppliedCoupon,
  type CouponRow,
} from "@/lib/coupon-service";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { fetchPromotions } from "@/lib/promotions-data";
import { toCartPromos } from "@/lib/promotions";
import { verifyCart, type VerifiableItem } from "@/lib/verify-cart";
import type { OrderLineItem } from "@/lib/types";

export const runtime = "nodejs";

/**
 * A translated cart error that keeps the machine-readable fields alongside it.
 *
 * The customer screen acts on `unavailableItemId` / `missingModifiers` to
 * highlight the offending line, so the message can't just be a bare string —
 * and it can't stay English either, which is what it was until now.
 */
async function cartError(
  key: string,
  vars: Record<string, string | number>,
  status: number,
  extra: Record<string, unknown>,
): Promise<NextResponse> {
  const messages = messagesFor(await getLocale());
  return NextResponse.json({ error: translate(messages, key, vars), ...extra }, { status });
}

// POST /api/checkout
// Body: { restaurantId, tableId, tableLabel, items: OrderLineItem[], note }
// Creates a pending order, then a Stripe Checkout Session, and returns its URL.
/** A restaurant with no readable plan has no plan permissions. */
const NO_PLAN = { allows_counter_payment: false } as PlanLimits;

export async function POST(req: NextRequest) {
  try {
    // Throttle abusive callers before we create any orders or Stripe sessions.
    if (await isRateLimited(`checkout:${clientIp(req)}`, 10, 60)) {
      return await apiError("apiErr.tooManyAttempts", 429);
    }

    const body = await req.json();
    const {
      restaurantId,
      tableId,
      tableLabel,
      items,
      note,
      tipPct: rawTipPct,
      tipAmount: rawTipAmount,
      couponCode,
      payLater,
    } = body as {
      restaurantId: string;
      tableId: string | null;
      tableLabel: string | null;
      items: OrderLineItem[];
      note?: string;
      tipPct?: number;
      tipAmount?: number;
      couponCode?: string;
      /** Dine-in: send the food now and settle at the end. */
      payLater?: boolean;
    };

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
        "id, currency, service_pct, service_enabled, accepting_orders, tax_pct, stripe_account_id, stripe_charges_enabled, allow_pay_later, allow_counter_payment",
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

    // A menu switched off — or outside its opening hours — stops being
    // orderable, not just invisible. Without this a page left open through
    // closing time could still check out, and so could a hand-made request.
    const [menusRes, zoneRes, catsRes] = await Promise.all([
      supabase
        .from("menus")
        .select("id, active, schedule")
        .eq("restaurant_id", restaurantId),
      supabase.from("restaurants").select("timezone").eq("id", restaurantId).single(),
      supabase.from("categories").select("id, menu_id").eq("restaurant_id", restaurantId),
    ]);
    const { ids: openIds, closedNow } = openMenuIds(
      (menusRes.data as MenuOpenState[] | null) ?? [],
      (zoneRes.data as { timezone?: string } | null)?.timezone ?? DEFAULT_TIME_ZONE,
    );
    if (closedNow) {
      return await apiError("apiErr.closedNow", 409);
    }
    const menuOfCategory = new Map(
      ((catsRes.data as { id: string; menu_id: string | null }[] | null) ?? []).map(c => [
        c.id,
        c.menu_id,
      ]),
    );
    /** Extras have no category of their own; they ride with their product. */
    const onOpenMenu = (categoryId: string | null): boolean => {
      if (!categoryId) return true;
      const menuId = menuOfCategory.get(categoryId);
      return !menuId || openIds.includes(menuId);
    };

    // An unpaid order only leaves here if something holds it, and that is always
    // decided from the database, never from what the client says:
    //
    //   - at a table, the table holds it: the bill stays open and the waiter
    //     collects at the end, if the owner allows it;
    //   - on the general QR there is no table to come back to, so what holds it
    //     is the counter: the customer goes to the till, pays and collects.
    //
    // Without one of those two, anyone claiming `payLater` would walk off with
    // food nobody can charge for.
    // Paying at the till also comes with the plan, and is asked here rather than
    // only when the switch is flipped: someone downgrading to Carta keeps the
    // switch on in the database, and without this would go on giving away orders
    // with no fee on the free plan.
    const atTable = Boolean(tableId) && Boolean(restaurant.allow_pay_later);
    const atCounter =
      !tableId &&
      Boolean(restaurant.allow_counter_payment) &&
      can((await getPlan(restaurantId))?.limits ?? NO_PLAN, "counterPayment");
    const deferred = Boolean(payLater) && (atTable || atCounter);
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
    const promotions = await fetchPromotions(supabase, restaurantId, {
      activeOnly: true,
    });
    const cartPromos = toCartPromos(promotions);

    // IMPORTANT: never trust client prices. Re-fetch every referenced item
    // (products AND extras) plus every combo component, so the verification
    // below can price them from the DB and check they're all still orderable.
    const comboComponentIds = promotions
      .filter(p => items.some(i => i.comboId === p.id))
      .flatMap(p => p.items.map(i => i.item_id));
    const referencedIds = [
      ...new Set([
        ...items.flatMap(i => [i.itemId, ...(i.extras?.map(e => e.id) ?? [])]),
        ...comboComponentIds,
      ]),
    ];
    const { data: dbItems, error: iErr } = await supabase
      .from("menu_items")
      .select("id, name, price, emoji, available, discount_pct, modifiers, category_id")
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
    });
    if (!result.ok) {
      const r = result.rejection;
      if (r.kind === "unavailable") {
        // Without a name — an id that was never on this menu — the sentence has
        // to stand on its own rather than naming a blank.
        const key = r.name ? "apiErr.itemGone" : "apiErr.itemGoneUnnamed";
        return await cartError(key, { name: r.name }, 400, {
          unavailableItemId: r.itemId,
        });
      }
      if (r.kind === "missingModifiers") {
        return await cartError(
          "apiErr.chooseFirst",
          { options: r.unanswered.join(", "), name: r.forName },
          400,
          { missingModifiers: r.unanswered, unansweredItemId: r.itemId },
        );
      }
      return NextResponse.json(
        { removedExtraIds: r.ids, removedExtraNames: r.names },
        { status: 409 },
      );
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

    // The code is re-checked here from the DB — a client that skipped or faked
    // /validate gets no advantage, and the claim below is what enforces the
    // usage cap under concurrency.
    let coupon: CouponRow | null = null;
    if (typeof couponCode === "string" && couponCode.trim()) {
      const found = await findCoupon(restaurantId, couponCode);
      if (!found) {
        return NextResponse.json({ couponReason: "notFound" }, { status: 409 });
      }
      // Same rule as the validate endpoint: a floor-only code is not a code a
      // customer can spend, however they got hold of it.
      if (found.staff_only) return await apiError("apiErr.couponNotFound", 400);

      const problem = couponProblem(found, base.subtotal);
      if (problem) {
        return NextResponse.json({ couponReason: problem }, { status: 409 });
      }
      // Reserve the use now. If anything below fails we hand it back.
      if (!(await claimCoupon(found.id))) {
        return NextResponse.json({ couponReason: "limitReached" }, { status: 409 });
      }
      coupon = found;
    }

    const pricing = coupon ? priceWith(toAppliedCoupon(coupon)) : base;
    const { subtotal, serviceFee, tip, total } = pricing;
    const servicePct = restaurant.service_enabled ? restaurant.service_pct : 0;

    /** Give back a reserved coupon use when this checkout doesn't complete. */
    const undoClaim = async () => {
      if (coupon) await releaseCoupon(coupon.id);
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

    // Create the pending order first so the webhook can find it.
    const { data: order, error: oErr } = await supabase
      .from("orders")
      .insert({
        restaurant_id: restaurantId,
        table_id: tableId,
        table_label: tableLabel,
        session_id: sessionId,
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
        paid: false,
      })
      .select("id")
      .single();

    if (oErr || !order) {
      await undoClaim();
      return await apiError("apiErr.orderCreate", 500);
    }

    // Nothing to charge now: the order is with the kitchen and the table owes
    // for it. The bill screen picks it up from here.
    if (deferred) {
      return NextResponse.json({ orderId: order.id, deferred: true, sessionId });
    }

    const origin = req.headers.get("origin") ?? new URL(req.url).origin;
    const cur = restaurant.currency.toLowerCase();

    // Line items for Stripe (amounts in the smallest currency unit).
    const line_items: import("stripe").Stripe.Checkout.SessionCreateParams.LineItem[] =
      verified.map(v => {
        const modText = Object.entries(v.mods ?? {})
          .map(([k, val]) => `${k}: ${Array.isArray(val) ? val.join(", ") : val}`)
          .join(" · ");
        const extrasText = v.extras?.length
          ? `Extras: ${v.extras.map(e => e.name).join(", ")}`
          : "";
        const description = [modText, extrasText].filter(Boolean).join(" · ");
        // Charge the sale price. Discounting the line itself (rather than
        // bolting a credit on the end) keeps the Stripe receipt honest about
        // what each item actually cost.
        const unitAmount =
          itemSalePrice(v.price, v.discountPct) +
          (v.extras?.reduce((s, e) => s + e.price, 0) ?? 0);
        return {
          quantity: v.qty,
          price_data: {
            currency: cur,
            unit_amount: Math.round(unitAmount * 100),
            product_data: {
              name: `${v.emoji ? `${v.emoji} ` : ""}${v.name}`,
              ...(description ? { description } : {}),
            },
          },
        };
      });

    if (serviceFee > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency: cur,
          unit_amount: Math.round(serviceFee * 100),
          product_data: { name: `Service charge (${servicePct}%)` },
        },
      });
    }

    if (tip > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency: cur,
          unit_amount: Math.round(tip * 100),
          product_data: { name: tipAmount !== null ? "Tip" : `Tip (${tipPct}%)` },
        },
      });
    }

    // Stripe Checkout supports card, Apple Pay and Google Pay automatically
    // via the card payment method (wallets show on supported devices).
    // Destination charge: the platform creates the charge, then routes the
    // funds to the restaurant's connected account, minus our cut. What that

    // Item discounts are already baked into each line's unit_amount. What's
    // left — the coupon and any quantity deal — is money off the order as a
    // whole, and Stripe has no negative line item, so it goes on as a one-off
    // coupon. The line items minus this equals `total` exactly.
    const amountOffCents = Math.round(
      (pricing.couponDiscount + pricing.promoDiscount) * 100,
    );

    let session;
    try {
      const discounts =
        amountOffCents > 0
          ? [
              {
                coupon: (
                  await stripe.coupons.create(
                    {
                      amount_off: amountOffCents,
                      currency: cur,
                      duration: "once",
                      name: coupon ? `Coupon ${coupon.code}` : "Discount",
                    },
                    // Same account as the session below, or Stripe cannot
                    // find the coupon when the checkout page loads.
                    { stripeAccount: restaurant.stripe_account_id },
                  )
                ).id,
              },
            ]
          : undefined;

      // A DIRECT charge: the payment is created on the restaurant's own Stripe
      // account, so Stripe's processing fee comes out of their balance and our
      // application fee comes to us clean.
      //
      // It used to be a destination charge on the platform, which meant Stripe
      // billed US for every order a diner paid: MX$13.80 on a MX$300 ticket
      // against MX$0.75 collected. Every restaurant we signed made that worse.
      // Settling a table already worked this way — now both paths do.
      session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          line_items,
          ...(discounts ? { discounts } : {}),
          success_url: `${origin}/order/${order.id}?paid=1`,
          cancel_url: `${origin}/r/${restaurantId}${tableId ? `/t/${tableId}` : ""}?cancelled=1`,
          metadata: { order_id: order.id },
          payment_intent_data: {
            metadata: { order_id: order.id },
            ...(appFee > 0 ? { application_fee_amount: appFee } : {}),
          },
        },
        { stripeAccount: restaurant.stripe_account_id },
      );
    } catch (err) {
      // Stripe refused the session — the pending order will never be paid, so
      // remove it instead of leaving an orphan row, and give back the coupon
      // use we reserved.
      await supabase.from("orders").delete().eq("id", order.id);
      await undoClaim();
      const code = err && typeof err === "object" && "code" in err ? err.code : undefined;
      if (code === "amount_too_small") {
        return NextResponse.json(
          {
            error:
              "That total is below the card minimum — please add a little more to your order.",
          },
          { status: 400 },
        );
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
