import { dinerCheckoutOrders } from "@/lib/diner-checkout-orders";
import { dinerCurrency } from "@/lib/diner-currency";
import { openDinerAttempt, resumeDinerAttempt } from "@/lib/diner-attempt";
import { billEntitlements, remainingPrincipal } from "@/lib/bill-principal";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { packOrderIds, stripeProductName } from "@/lib/stripe-limits";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { staffOpenedBill } from "@/lib/table-session";
import { isRoomLimited, isTableLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchTableBill } from "@/lib/bill-data";
import { tableBill } from "@/lib/table-bill";
import { getPlan } from "@/lib/plan-server";
import {
  NO_FEE, feeMetadata, releaseFee, reserveFeeCents,
} from "@/lib/platform-fee";
import { orderFeeCents } from "@/lib/plan";
import { round2 } from "@/lib/money";
import { siteOrigin } from "@/lib/site-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Paying one share of a divided bill.
 *
 * What is charged is the share frozen when the table agreed, plus whatever this
 * diner ordered afterwards — theirs alone, by the rule the table follows. Both
 * halves are read from the database here; the phone sends which orders it
 * thinks are its own and they are checked before a centavo is added.
 *
 * The tip is this person's own: the table agreed to divide the food and the
 * service charge, not to decide each other's generosity.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRoomLimited(req, "splitpay", 10)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }

  const body = await jsonBody<{
    splitId?: string; sessionId?: string; diner?: string; restaurantId?: string;
    tableId?: string; ownOrderIds?: string[]; tipPct?: number; tipAmount?: number;
  }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { splitId, sessionId, diner, restaurantId, tableId, ownOrderIds, tipPct, tipAmount } = body;
  if (await isTableLimited(req, "splitpay", tableId, 10)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }
  if (!splitId || !sessionId || !diner || !restaurantId || !tableId) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  // The same refusal the bill screen makes, made where it counts: a share
  // charged here is money the waiter's running balance never sees.
  // A guard that cannot read refuses: a failed read is not leave to charge.
  const waiterSettles = await staffOpenedBill(restaurantId, tableId).catch(() => null);
  if (waiterSettles === null) return await apiError("apiErr.verifyOrders", 503);
  if (waiterSettles) return await apiError("apiErr.waiterSettles", 409);

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

  const { data: split } = await db
    .from("bill_splits")
    .select("id, status, locked_at, session_id, shares, amount, food_principal, restaurant_id, order_ids")
    .eq("id", splitId)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (!split || split.status !== "locked") return await apiError("apiErr.splitNotReady", 409);
  // The split, its sitting and the table all belong to the restaurant whose
  // Stripe account takes the money. Nothing tied them before: a diner holding
  // a real share of one restaurant's split could name another restaurant
  // that takes cards, pay THAT account, and have the first restaurant's share
  // marked paid with none of the money.
  const { data: sitting } = await db
    .from("table_sessions").select("id")
    .eq("id", sessionId).eq("restaurant_id", restaurantId).eq("table_id", tableId)
    .maybeSingle();
  if (split.restaurant_id !== restaurantId || !sitting) return await apiError("apiErr.splitNotYours", 403);

  const { data: claim } = await db
    .from("bill_split_claims")
    .select("share_no, amount, paid_at")
    .eq("split_id", splitId)
    .eq("diner", diner)
    .maybeSingle();
  if (!claim) return await apiError("apiErr.splitNotYours", 403);
  if (claim.paid_at) return await apiError("apiErr.splitAlreadyPaid", 409);

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const scopeKey = `split:${splitId}:${claim.share_no}`;
  try {
    const prior = await resumeDinerAttempt(stripe, restaurantId, scopeKey);
    if (prior) return NextResponse.json({ url: prior.url });
  } catch { return await apiError("apiErr.checkoutFailed", 502); }

  // Their own orders since the freeze — verified, never taken on trust: unpaid,
  // at this table's sitting, and placed after it locked.
  const orders = await fetchTableBill(restaurantId, tableId, "diner", sessionId);
  const wanted = new Set(Array.isArray(ownOrderIds) ? ownOrderIds : []);
  // Parsed, never compared as text: Postgres returns "+00:00" where JavaScript
  // writes "Z", and as strings that can sort the wrong way round.
  const froze = Date.parse(split.locked_at as string);
  const own = orders.filter(
    o => wanted.has(o.id) && !o.paid && Date.parse(o.created_at) > froze,
  );
  const ownTotal = round2(own.reduce((sum, o) => sum + Number(o.total) - Number(o.collected ?? 0), 0));

  const payable = round2(Number(claim.amount) + ownTotal);
  if (payable <= 0) return await apiError("apiErr.billSettled", 409);

  // The share is the amount frozen when the table agreed, and it has no idea
  // what has happened since. If the bill has been settled another way — a
  // waiter took cash, the floor wrote it off — charging it takes money for
  // food nobody owes for any more.
  if (tableBill(orders, []).total <= 0) return await apiError("apiErr.billSettled", 409);

  const pct = Math.min(100, Math.max(0, Number(tipPct) || 0));
  const asked = tipAmount != null ? Number(tipAmount) : (payable * pct) / 100;
  const tip = Math.min(Math.max(0, round2(asked)), payable);
  const cents = Math.round(round2(payable + tip) * 100);

  // Our cut is the table's, not one per person: a bill divided four ways is
  // still one bill, and charging the restaurant four times for the courtesy of
  // splitting it would be a fee for using the feature. So each share carries
  // its slice of that one fee (the odd cents on share 1), reserved under its
  // own attempt. It used to ride whole on whichever share opened first, and a
  // share abandoned and reopened after another paid left the bill fee-free;
  // two shares opened at once each carried the whole fee.
  const feePlan = await getPlan(restaurantId);
  // A frozen principal never grows with this or another share's gratuity.
  // A pre-deploy split has no frozen principal: use what its food still owes.
  // That may take a smaller fee, but never asks diners to restart their split.
  const foodPrincipal = split.food_principal ?? remainingPrincipal(orders.filter(o => split.order_ids.includes(o.id)));
  const billFee = feePlan ? orderFeeCents(feePlan.limits, Math.round(Number(foodPrincipal) * 100)) : 0;
  const shares = Math.max(1, Number(split.shares) || 1);
  const slice = Math.floor(billFee / shares) + (claim.share_no === 0 ? billFee % shares : 0);
  let fee = NO_FEE;
  try {
    if (feePlan && slice > 0) {
      // The attempt excludes a second session even when the fee is zero.
      // Each paid share still carries its slice of the table's single fee.
      fee = await reserveFeeCents(restaurantId, feePlan.limits, slice, "split");
    }
  } catch {
    return await apiError("apiErr.generic", 502);
  }
  const appFee = fee.cents;

  const origin = siteOrigin(req);

  // The split's frozen food decides the currency it is charged in, even after
  // a menu change. Asked last, once every refusal about the share's own state
  // has had its say: asked first, a settled bill or a share already being
  // opened was answered "could not verify the orders" instead.
  // No attempt is open yet, so the share's fee slice is all there is to give back.
  const giveBackFee = () => releaseFee(fee.id).catch(err => console.error("split pay: the fee reservation stays counted", err));
  const frozenOrders = await dinerCheckoutOrders(split.order_ids).catch(() => null);
  if (!frozenOrders?.length || frozenOrders.length !== split.order_ids.length) {
    await giveBackFee();
    return await apiError("apiErr.verifyOrders", 503);
  }
  const currency = dinerCurrency([...frozenOrders, ...own]);
  if (!currency) {
    await giveBackFee();
    return await apiError("apiErr.mixedCurrencies", 409);
  }

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
              product_data: { name: stripeProductName(`${restaurant.name} — 1/${split.shares}`) },
            },
          },
        ],
        // The webhook is the only thing that believes any of this happened.
        metadata: {
          restaurant_id: restaurantId,
          split_id: splitId,
          split_share: String(claim.share_no),
          split_amount: String(claim.amount),
          ...packOrderIds(own.map(o => o.id)),
          settle_tip: String(tip),
          ...feeMetadata(fee, restaurantId),
        },
        payment_intent_data: {
          metadata: feeMetadata(fee, restaurantId),
          ...(appFee > 0 ? { application_fee_amount: appFee } : {}),
        },
        // Half an hour, for the same reason a cart gets one: a share left
        // unpaid on a Stripe page must not hold the table's bill open all day.
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
        success_url: `${origin}/r/${restaurantId}/t/${tableId}?settled=1`,
        cancel_url: `${origin}/r/${restaurantId}/t/${tableId}?cancelled=1`,
      },
      {
        restaurantId, stripeAccount: restaurant.stripe_account_id, currency, amountCents: cents,
        orderIds: [...split.order_ids, ...own.map(o => o.id)], payableIds: own.map(o => o.id), scopeKey,
        entitlements: billEntitlements(own, 0).entitlements, foodPrincipal: Number(foodPrincipal),
      },
    );

    // A session with no page is still a session: its fee waits for expiry.
    if (!session.url) return await apiError("apiErr.generic", 502);
    return NextResponse.json({ url: session.url });
  } catch {
    // Released only when Stripe refused outright: an answer that never
    // arrived may still be a session, which Stripe's expiry releases.
    // `openDinerAttempt` releases only the reservation it knows was refused.
    return await apiError("apiErr.generic", 502);
  }
}
