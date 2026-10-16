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
  NO_FEE, attachFeeSession, feeMetadata, releaseFee, reserveFeeCents, retirePriorShareSession, stripeRefusedOutright,
} from "@/lib/platform-fee";
import { orderFeeCents } from "@/lib/plan";
import { round2 } from "@/lib/money";

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
    .select("id, status, locked_at, session_id, shares, amount, restaurant_id")
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
  const ownTotal = round2(own.reduce((sum, o) => sum + Number(o.total), 0));

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
  // own `ref`. It used to ride whole on whichever share opened first, and a
  // share abandoned and reopened after another paid left the bill fee-free;
  // two shares opened at once each carried the whole fee.
  const feePlan = await getPlan(restaurantId);
  const billFee = feePlan ? orderFeeCents(feePlan.limits, Math.round(Number(split.amount) * 100)) : 0;
  const shares = Math.max(1, Number(split.shares) || 1);
  const slice = Math.floor(billFee / shares) + (claim.share_no === 1 ? billFee % shares : 0);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const onTheirAccount = { stripeAccount: restaurant.stripe_account_id };
  const ref = `split:${splitId}:${claim.share_no}`;
  let fee = NO_FEE;
  try {
    if (feePlan && slice > 0) {
      // The share reopened: its earlier session is expired first, so the new
      // one carries the slice and the old can no longer be paid fee-free.
      const prior = await retirePriorShareSession(
        restaurantId, ref,
        id => stripe.checkout.sessions.expire(id, {}, onTheirAccount),
        id => stripe.checkout.sessions.retrieve(id, {}, onTheirAccount),
      );
      if (prior === "paid") return await apiError("apiErr.splitAlreadyPaid", 409);
      fee = await reserveFeeCents(restaurantId, feePlan.limits, slice, "split", ref);
    }
  } catch {
    return await apiError("apiErr.generic", 502);
  }
  const appFee = fee.cents;
  const giveBackFee = () => releaseFee(fee.id).catch(err => console.error("split pay: the fee reservation stays counted", err));

  const origin = req.headers.get("origin") ?? new URL(req.url).origin;

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
              product_data: { name: stripeProductName(`${restaurant.name} — 1/${split.shares}`) },
            },
          },
        ],
        // The webhook is the only thing that believes any of this happened.
        metadata: {
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
      { stripeAccount: restaurant.stripe_account_id },
    );

    await attachFeeSession(fee, session.id);
    // A session with no page is still a session: its fee waits for expiry.
    if (!session.url) return await apiError("apiErr.generic", 502);
    return NextResponse.json({ url: session.url });
  } catch (err) {
    // Released only when Stripe refused outright: an answer that never
    // arrived may still be a session, which Stripe's expiry releases.
    if (stripeRefusedOutright(err)) await giveBackFee();
    return await apiError("apiErr.generic", 502);
  }
}
