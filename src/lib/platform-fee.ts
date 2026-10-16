import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { orderFeeCents, type PlanLimits } from "@/lib/plan";

/**
 * Our per-order fee, kept in its own ledger (`platform_fees`), one row per
 * charge. The month's ceiling is read from here and nowhere else.
 *
 * It used to be summed from `orders.platform_fee`, which records neither
 * when a charge happened, whether it went through, nor how much of it was
 * given back: the ceiling counted abandoned checkouts, missed a divided
 * bill's fee until every share landed, filed a fee under the month its food
 * was ordered, lost one whose write failed, and could not see two diners
 * paying at once. Now:
 *
 *   - a checkout RESERVES its fee before Stripe is asked, under a lock per
 *     restaurant (`reserve_platform_fee`), so two checkouts at once never
 *     both fit under one ceiling;
 *   - the payment marks it TAKEN (`takeFee`, from the settling webhook);
 *   - only a session that was never created, or Stripe's expiry, RELEASES it;
 *   - a refund records the share of the fee that went back, rounded down.
 *
 * A reservation nobody confirms keeps counting — a little over, never under:
 * counting short is the one way to charge a restaurant past its ceiling.
 */

export type FeeSource = "order" | "bill" | "split" | "account";

/** A reserved fee: what the Stripe session charges, and the row that holds it. */
export interface FeeHold {
  /** Null when nothing is charged: no fee on the plan, or the ceiling is reached. */
  id: string | null;
  cents: number;
}

export const NO_FEE: FeeHold = { id: null, cents: 0 };

/**
 * Reserve the fee for one checkout of `totalCents` worth of food. Capped
 * against the food, never the tip. `ref` names something that pays one fee
 * however many sessions it opens — a divided bill.
 */
export async function reserveFee(
  restaurantId: string,
  limits: PlanLimits,
  totalCents: number,
  source: FeeSource,
  ref: string | null = null,
): Promise<FeeHold> {
  const perOrder = orderFeeCents(limits, totalCents);
  if (perOrder <= 0) return NO_FEE;
  const cap = limits.fee_cap === null || limits.fee_cap === undefined ? null : Math.round(limits.fee_cap * 100);
  const { data, error } = await createAdminClient().rpc("reserve_platform_fee", {
    p_restaurant: restaurantId,
    p_cents: perOrder,
    p_cap_cents: cap,
    p_source: source,
    p_ref: ref,
  });
  // Unreserved is not "free": a checkout that cannot hold its fee is refused,
  // rather than charging a fee the ceiling never saw.
  if (error) throw new Error(`Could not reserve the platform fee: ${error.message}`);
  const row = (data as { fee_id: string; fee_cents: number }[] | null)?.[0];
  return row ? { id: row.fee_id, cents: row.fee_cents } : NO_FEE;
}

/** Give back a reservation whose session was never created, or that expired. */
export async function releaseFee(id: string | null | undefined): Promise<void> {
  if (!id) return;
  const { error } = await createAdminClient().rpc("release_platform_fee", { p_fee: id });
  if (error) throw new Error(`Could not release the platform fee: ${error.message}`);
}

/**
 * A session's payment landed: its fee is ours. Throws on failure, so the
 * webhook answers Stripe with an error and Stripe sends the event again.
 */
export async function takeFee(id: string | undefined, session: Stripe.Checkout.Session): Promise<void> {
  if (!id) return;
  const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  const { error } = await createAdminClient().rpc("take_platform_fee", {
    p_fee: id,
    p_intent: intent,
    p_charge_cents: session.amount_total ?? 0,
  });
  if (error) throw new Error(`Could not record the platform fee: ${error.message}`);
}

/** Stripe's expiry for a session nobody paid. */
export async function releaseSessionFee(session: Stripe.Checkout.Session): Promise<void> {
  await releaseFee(session.metadata?.fee_id);
}

/**
 * A refund on a charge that carried our fee. Stripe returns the fee in
 * proportion to what was refunded; this records that share, once per refund.
 */
export async function refundFee(restaurantId: string, intent: string, refundCents: number, refundId: string): Promise<void> {
  const { error } = await createAdminClient().rpc("refund_platform_fee", {
    p_restaurant: restaurantId,
    p_intent: intent,
    p_refund_cents: refundCents,
    p_refund_id: refundId,
  });
  if (error) throw new Error(`Could not record the fee refunded: ${error.message}`);
}

/** The fees we kept on payments settled since `since`, in pesos: the costs screen's figure. */
export async function feesKeptSince(restaurantId: string, since: string): Promise<number> {
  const db = createAdminClient();
  const rows = await everyRow<{ cents: number; refunded_cents: number }>((a, b) => db
    .from("platform_fees")
    .select("cents, refunded_cents")
    .eq("restaurant_id", restaurantId).eq("status", "taken")
    .gte("settled_at", since)
    .order("id").range(a, b), "the fees kept");
  return rows.reduce((sum, f) => sum + f.cents - f.refunded_cents, 0) / 100;
}
