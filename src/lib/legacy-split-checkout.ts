import type Stripe from "stripe";
import type { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { resumeDinerAttempt } from "@/lib/diner-attempt";
import { round2 } from "@/lib/money";

/** How an open page for an old share compares with what this request quotes. */
export type LegacySplitQuote = "same" | "tip" | "total" | "unverified";

/** Compare a resumed page, or a concurrent winner returned by the opener, with this quote. */
export function legacySplitQuote(session: Stripe.Checkout.Session, payable: number, tip: number): LegacySplitQuote {
  const evidence = session.metadata?.settle_tip;
  const savedTip = Number(evidence);
  if (!evidence?.trim() || !Number.isFinite(savedTip) || savedTip < 0) return "unverified";
  if (savedTip !== tip) return "tip";
  if (session.amount_total !== Math.round(round2(payable + tip) * 100)) return "total";
  return "same";
}

/**
 * The diner's answer for a page that is not this quote. Every key here is
 * diner copy: `apiErr.billChanged` speaks to a waiter collecting a bill.
 */
export async function legacySplitRefusal(quote: LegacySplitQuote): Promise<NextResponse | null> {
  if (quote === "unverified") return await apiError("apiErr.verifyOrders", 503);
  if (quote === "tip") return await apiError("apiErr.splitOpenTip", 409);
  if (quote === "total") return await apiError("apiErr.splitPageChanged", 409);
  return null;
}

/**
 * Close an open page with a different tip or a total this share no longer
 * owes: the diner ordered more, or a waiter collected part of a later order.
 * Before this, every Pay
 * was refused until Stripe's own 30-minute expiry. Stripe expires the page
 * first, so it can no longer charge; resuming the attempt then reads it back
 * as expired and closes it through `finish_diner_checkout`, which gives back
 * its fee and coupon exactly as Stripe's expiry webhook does (that webhook
 * arrives later and finds nothing left to do). Answers false whenever the old
 * page is not proven closed: paid, being paid, unreadable, or replaced by
 * another request in the meantime.
 */
export async function retireStaleLegacyPage(
  stripe: Stripe, session: Stripe.Checkout.Session, stripeAccount: string, restaurantId: string, scopeKey: string,
): Promise<boolean> {
  try {
    const expired = await stripe.checkout.sessions.expire(session.id, {}, { stripeAccount });
    if (expired.status !== "expired" || expired.payment_status !== "unpaid") return false;
    return await resumeDinerAttempt(stripe, restaurantId, scopeKey) === null;
  } catch (err) {
    console.error("split pay: a stale share page could not be closed", err);
    return false;
  }
}
