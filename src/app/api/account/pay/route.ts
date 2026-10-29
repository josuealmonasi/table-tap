import { checkoutPageRpc } from "@/lib/checkout-page-rpc";
import { dinerCheckoutOrders } from "@/lib/diner-checkout-orders";
import { dinerCurrency, isDinerCurrency } from "@/lib/diner-currency";
import { DinerAttemptRejected, openDinerAttempt, resumeDinerAttempt } from "@/lib/diner-attempt";
import { billEntitlements, remainingPrincipal } from "@/lib/bill-principal";
import { NextResponse, type NextRequest } from "next/server";
import Stripe from "stripe";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientKey, isRateLimited } from "@/lib/rate-limit";
import { normalizeCode } from "@/lib/accounts";
import { accountByCode } from "@/lib/accounts-server";
import { releaseAccountCheckout } from "@/lib/account-checkout";
import { stripeProductName } from "@/lib/stripe-limits";
import { getPlan } from "@/lib/plan-server";
import { NO_FEE, feeMetadata, reserveFee } from "@/lib/platform-fee";
import { round2 } from "@/lib/money";
import { siteOrigin } from "@/lib/site-origin";

export const runtime = "nodejs";

// POST /api/account/pay — the customer pays their whole account by card.
//
// Body: { c, expected, tipPct?, tipAmount? } — `c` is the account's code and
// `expected` the balance the statement showed. The database opens the payment
// on exactly the orders owed now and holds the account against being
// collected at the till until Stripe answers; the webhook is what records it.
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRateLimited(`account-pay:${clientKey(req)}`, 10, 60)) {
    return await apiError("apiErr.tooManyWait", 429);
  }
  const body = await jsonBody<{ c?: unknown; expected?: unknown; tipPct?: unknown; tipAmount?: unknown; currency?: unknown }>(req);
  const code = normalizeCode(typeof body?.c === "string" ? body.c : "");
  const expected = Number(body?.expected);
  if (!code || !Number.isFinite(expected) || expected <= 0) return await apiError("apiErr.invalidRequest", 400);
  if (body?.currency !== undefined && !isDinerCurrency(body.currency)) return await apiError("apiErr.invalidRequest", 400);

  const account = await accountByCode(code).catch(() => undefined);
  if (account === undefined) return await apiError("apiErr.generic", 500);
  if (!account) return await apiError("account.notFound", 404);

  const db = createAdminClient();
  const { data: restaurant } = await db
    .from("restaurants")
    .select("id, name, currency, stripe_account_id, stripe_charges_enabled")
    .eq("id", account.restaurant_id)
    .maybeSingle();
  if (!restaurant) return await apiError("apiErr.generic", 500);
  if (!restaurant.stripe_account_id || !restaurant.stripe_charges_enabled) {
    return await apiError("apiErr.noCardPayments", 409);
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const scopeKey = body?.currency ? `account:${account.id}:${body.currency}` : `account:${account.id}`;
  try {
    const prior = await resumeDinerAttempt(stripe, restaurant.id, scopeKey);
    if (prior) return NextResponse.json({ url: prior.url });
  } catch { return await apiError("apiErr.checkoutFailed", 502); }

  // The same gratuity rule as a table's bill: a percentage or an amount, and
  // never more than the food it thanks somebody for.
  const pct = Math.min(100, Math.max(0, Number(body?.tipPct) || 0));
  const asked = body?.tipAmount != null ? Number(body.tipAmount) : (expected * pct) / 100;
  const tip = Math.min(Math.max(0, round2(Number.isFinite(asked) ? asked : 0)), expected);

  const refused = async (key: string, status: number) => await apiError(key, status);
  const { data: opened, error: openError } = await checkoutPageRpc(body?.currency ? "account_checkout_currency_v1" : "account_checkout_open_v2", {
    p_restaurant: restaurant.id,
    p_account: account.id,
    p_expected: expected,
    p_tip: tip,
    p_fee: 0,
    ...(body?.currency ? { p_currency: body.currency } : {}),
  });
  if (openError) return await refused("apiErr.generic", 500);
  const r = opened as { outcome: string; checkout?: string; amount?: number; tip?: number };
  if (r.outcome === "paying") return await refused("apiErr.accountPayingOnline", 409);
  if (r.outcome === "nothing") return await refused("apiErr.accountNothingOwed", 409);
  if (r.outcome === "changed") return await refused("apiErr.accountStatementChanged", 409);
  if (r.outcome !== "open" || !r.checkout) return await refused("apiErr.generic", 500);

  const { data: checkout, error: checkoutError } = await db.from("account_checkouts").select("order_ids")
    .eq("id", r.checkout).eq("restaurant_id", restaurant.id).single();
  const orders = checkoutError || !checkout ? null : await dinerCheckoutOrders(checkout.order_ids).catch(() => null);
  const currency = orders ? dinerCurrency(orders) : null;
  if (!checkout || !currency || !orders || orders.length !== checkout.order_ids.length) {
    await releaseAccountCheckout(r.checkout);
    return await refused(!orders ? "apiErr.verifyOrders" : "apiErr.mixedCurrencies", !orders ? 503 : 409);
  }

  const plan = await getPlan(restaurant.id);
  const foodPrincipal = remainingPrincipal(orders);
  let fee = NO_FEE;
  try {
    fee = plan ? await reserveFee(restaurant.id, plan.limits, Math.round(foodPrincipal * 100), "account") : NO_FEE;
  } catch {
    await releaseAccountCheckout(r.checkout);
    return await apiError("apiErr.checkoutFailed", 502);
  }
  const feeCents = fee.cents;
  // One card payment for one account: the single fee an order carries,
  // capped against the food and not the tip, reserved under the month's ceiling.
  // Every failure before Stripe gives it back; an unknown Stripe answer keeps it.
  const origin = siteOrigin(req);
  const cents = Math.round(round2(Number(r.amount) + Number(r.tip)) * 100);
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
              product_data: { name: stripeProductName(`${restaurant.name} — ${account.name}`) },
            },
          },
        ],
        // The webhook settles exactly this checkout. A returning browser
        // proves nothing about whether money moved.
        metadata: { restaurant_id: restaurant.id, account_checkout: r.checkout, ...feeMetadata(fee, restaurant.id) },
        payment_intent_data: {
          metadata: feeMetadata(fee, restaurant.id),
          ...(feeCents > 0 ? { application_fee_amount: feeCents } : {}),
        },
        success_url: `${origin}/cuenta/${code}?paid=1`,
        cancel_url: `${origin}/cuenta/${code}?cancelled=1`,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      },
      {
        restaurantId: restaurant.id, stripeAccount: restaurant.stripe_account_id, currency, amountCents: cents,
        orderIds: checkout.order_ids, payableIds: checkout.order_ids, scopeKey,
        entitlements: billEntitlements(orders, 0).entitlements, foodPrincipal,
      },
    );
    await db.from("account_checkouts").update({ stripe_session_id: session.id }).eq("id", r.checkout);
    return NextResponse.json({ url: session.url });
  } catch (err) {
    // A rejected quote never reached Stripe: the till may collect again. If
    // releasing fails the saved hold stays for verified recovery. An unknown
    // response can still be a payable session, so its attempt, fee and hold
    // survive for the same retry.
    // The attempt releases an initial Stripe refusal and its own account hold.
    if (err instanceof DinerAttemptRejected) {
      await releaseAccountCheckout(r.checkout);
    }
    return await apiError("apiErr.checkoutFailed", 502);
  }
}
