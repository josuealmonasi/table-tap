import { dinerCurrency } from "@/lib/diner-currency";
import { openDinerAttempt, resumeDinerAttempt } from "@/lib/diner-attempt";
import { remainingPrincipal, billEntitlements } from "@/lib/bill-principal";
import { fetchTableBill } from "@/lib/bill-data";
import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { MAX_BILL_ORDERS } from "@/lib/table-bill";
import { packOrderIds, stripeProductName } from "@/lib/stripe-limits";
import { staffOpenedBill } from "@/lib/table-session";
import { splitInProgress } from "@/lib/split-service";
import { isRoomLimited, isTableLimited } from "@/lib/rate-limit";
import { PaymentAttributionRequired } from "@/lib/payment-coverage";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlan } from "@/lib/plan-server";
import { NO_FEE, feeMetadata, reserveFee } from "@/lib/platform-fee";
import { applyCoupon } from "@/lib/pricing";
import {
  couponProblem,
  findCoupon,
  toAppliedCoupon,
} from "@/lib/coupon-service";
import { round2 } from "@/lib/money";
import { siteOrigin } from "@/lib/site-origin";

export const runtime = "nodejs";

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
  if (await isRoomLimited(req, "billpay", 10)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }

  const body = await jsonBody<{
    restaurantId?: string;
    tableId?: string;
    sessionId?: string;
    orderIds?: string[];
    tipPct?: number;
    tipAmount?: number;
    couponCode?: string;
  }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { restaurantId, tableId, orderIds, tipPct, tipAmount, couponCode, sessionId } = body;
  if (await isTableLimited(req, "billpay", tableId, 10)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }
  if (!restaurantId || !tableId || !Array.isArray(orderIds) || orderIds.length === 0) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  // A table does not run up two hundred open orders, and the lookup below puts
  // every id in a URL: a thousand of them is already a Bad Request, five
  // thousand a 414 from the proxy. Unchecked, that failure read as an empty
  // result and the diner was told their bill was settled when it is not.
  if (orderIds.length > MAX_BILL_ORDERS) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  // A bill a waiter opened is settled with the waiter. They are standing at
  // the table with a machine and a running balance, and a card charged here at
  // the same moment pays for food they are about to collect for — the table
  // pays twice and only one of the two payments is anywhere anybody is looking.
  //
  // Neither guard may answer "no" because it could not read: that is the one
  // answer that lets the charge through. A failed read refuses, like the
  // orders read below.
  const waiterSettles = await staffOpenedBill(restaurantId, tableId).catch(() => null);
  if (waiterSettles === null) return await apiError("apiErr.verifyOrders", 503);
  if (waiterSettles) return await apiError("apiErr.waiterSettles", 409);

  // And the same refusal for a table dividing it between themselves. A phone
  // that ordered but never took a share still saw this button — three ordered,
  // two halved it — and paying here charges for food the shares are already
  // being collected for. The screen hides it; this is what makes it true.
  const dividing = await splitInProgress(restaurantId, tableId).catch(() => null);
  if (dividing === null) return await apiError("apiErr.verifyOrders", 503);
  if (dividing) return await apiError("apiErr.splitInProgress", 409);

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
  // A read that failed is not a bill that is paid. Told apart, because the
  // wrong one of the two sends somebody away from the table owing money.
  const visible = await fetchTableBill(restaurantId, tableId, "diner", sessionId)
    .catch(error => error instanceof PaymentAttributionRequired ? "review" as const : null);
  if (visible === "review") return await apiError("apiErr.attributionRequired", 409);
  if (!visible) return await apiError("apiErr.verifyOrders", 503);
  const wanted = new Set(orderIds);
  const orders = visible.filter(o => wanted.has(o.id) && !o.paid);
  // A stale or foreign selection needs another look; it is never called paid.
  if (orders.length !== wanted.size) return await apiError("apiErr.billChanged", 409);
  if (!orders.length) return await apiError("apiErr.billSettled", 409);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const scopeKey = `bill:${[...wanted].sort().join(",")}`;
  try {
    const prior = await resumeDinerAttempt(stripe, restaurantId, scopeKey);
    if (prior) return NextResponse.json({ url: prior.url });
  } catch { return await apiError("apiErr.checkoutFailed", 502); }

  const currency = dinerCurrency(orders);
  if (!currency) return await apiError("apiErr.mixedCurrencies", 409);

  if (couponCode && orders.some(o => Number(o.collected ?? 0) > 0)) return await apiError("apiErr.couponAlreadyUsed", 409);
  const food = round2(orders.reduce((sum, o) => sum + Number(o.total) - Number(o.collected ?? 0), 0));
  const principal = remainingPrincipal(orders);

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
    const found = await findCoupon(restaurantId, couponCode).catch(() => undefined);
    if (found === undefined) return await apiError("apiErr.couponLookupFailed", 503);
    coupon = found;
    if (!coupon || coupon.staff_only) return await apiError("apiErr.couponNotFound", 400);
    if (couponProblem(coupon, principal)) return await apiError("apiErr.couponNotValid", 400);

    // The attempt transaction reserves the last use together with its scope,
    // before a payable page exists; a losing request never owns another use.
    discount = applyCoupon(toAppliedCoupon(coupon), principal);
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
  if (cents <= 0) {
    return await apiError("apiErr.billSettled", 409);
  }

  // Marked before Stripe hears of it, so there is no moment when a checkout is
  // open on these orders and switching the service charge off could lower
  // them: the webhook records these same totals when the money lands, and a
  // total lowered in between records less than Stripe took (service-reprice).
  // `diner_checkout_open` marks the frozen orders in the transaction that
  // excludes every competing checkout, so this cannot be an unconditional hold.

  const origin = siteOrigin(req);
  // Reserved under the month's ceiling before Stripe is asked; given back
  // below when the session is never created, and by Stripe's expiry when it
  // is never paid (`releaseSessionFee`).
  let fee = NO_FEE;
  try {
    fee = feePlan ? await reserveFee(restaurantId, feePlan.limits, Math.round(Math.max(0, principal - discount) * 100), "bill") : NO_FEE;
  } catch {
    return await apiError("apiErr.checkoutFailed", 502);
  }
  const appFee = fee.cents;

  try {
    const session = await openDinerAttempt(stripe,
      {
        mode: "payment",
        // Cards only, as every checkout (see `card-session.ts`).
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: currency.toLowerCase(),
              unit_amount: cents,
              // One line: the diner is settling a bill, not re-picking dishes,
              // and the itemised list is on the screen they came from.
              product_data: {
                name: stripeProductName(
                  `${restaurant.name} — ${orders.length} ${orders.length === 1 ? "order" : "orders"}`,
                ),
              },
            },
          },
        ],
        // The webhook marks exactly these rows paid. It is the only thing that
        // does: a returning browser proves nothing about whether money moved.
        metadata: {
          restaurant_id: restaurantId,
          // Split across keys: one value stops at 500 characters, which is
          // fourteen order ids — a table of twelve on its second round.
          ...packOrderIds(orders.map(o => o.id)),
          // Recorded so the takings show what was actually collected. It lands
          // on one of the settled orders rather than being split across them:
          // a tip is for the table's service, not attributable to a dish.
          settle_tip: String(tip),
          settle_coupon: coupon?.code ?? "",
          settle_discount: String(discount),
          // Our fee, reserved in the ledger: the webhook takes it by `fee_id`.
          ...feeMetadata(fee, restaurantId),
        },
        payment_intent_data: {
          metadata: feeMetadata(fee, restaurantId),
          // Same as in /api/checkout: zero is not sent. Stripe refuses an application
          // fee of 0, so a restaurant with no per-order fee — the Grupo plan, or a
          // pilot we do not charge — could order by card and then be unable to pay the
          // bill at the table. The same rule was in one route and not the other.
          ...(appFee > 0 ? { application_fee_amount: appFee } : {}),
        },
        success_url: `${origin}/r/${restaurantId}/t/${tableId}?settled=1`,
        cancel_url: `${origin}/r/${restaurantId}/t/${tableId}?cancelled=1`,
        // Half an hour, as the other checkouts: the price is fixed while it is
        // open, and repricing holds off for as long (service-reprice).
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      },
      {
        restaurantId, stripeAccount: restaurant.stripe_account_id, currency, amountCents: cents,
        orderIds: orders.map(o => o.id), payableIds: orders.map(o => o.id), scopeKey,
        ...billEntitlements(orders, discount), couponId: coupon?.id, foodPrincipal: round2(principal - discount),
      },
    );

    // Reserved, not yet real: only this attempt's verified payment confirms
    // its coupon, and only this attempt's expiry gives that reservation back.

    return NextResponse.json({ url: session.url });
  } catch {
    // The attempt owns its coupon and fee. Only its initial outright refusal
    // or verified expiry releases them; an unknown answer can still be payable.
    return await apiError("apiErr.checkoutFailed", 502);
  }
}
