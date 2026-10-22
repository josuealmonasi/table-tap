import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
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
 *   - refund workflows reconcile Stripe's verified cumulative fee return.
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
  return reserveFeeCents(restaurantId, limits, orderFeeCents(limits, totalCents), source, ref);
}

/** Reserve a fee already worked out — a divided bill's share of its one fee. */
export async function reserveFeeCents(
  restaurantId: string,
  limits: PlanLimits,
  perOrder: number,
  source: FeeSource,
  ref: string | null = null,
): Promise<FeeHold> {
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

/** What a session carries so the webhook can find its fee, and record it without the row. */
export function feeMetadata(hold: FeeHold, restaurantId: string): Record<string, string> {
  return hold.id ? { fee_id: hold.id, fee_cents: String(hold.cents), restaurant_id: restaurantId } : {};
}

/**
 * Stripe answered that it made nothing: a 4xx. A dropped connection or a 5xx
 * may have made the session anyway (Stripe calls those indeterminate), and so
 * may a 409 — the same idempotency key still being worked on, which the SDK's
 * own retries can run into — so their fee stays counted until Stripe's expiry
 * says otherwise.
 */
export function stripeRefusedOutright(err: unknown): boolean {
  const status = err && typeof err === "object" && "statusCode" in err ? Number((err as { statusCode?: unknown }).statusCode) : NaN;
  return status >= 400 && status < 500 && status !== 409;
}

/** Give back a reservation whose session was never created, or that expired. */
export async function releaseFee(id: string | null | undefined): Promise<void> {
  if (!id) return;
  const { error } = await createAdminClient().rpc("release_platform_fee", { p_fee: id });
  if (error) throw new Error(`Could not release the platform fee: ${error.message}`);
}

/** What the session itself says about its fee, read by the webhook. */
export interface SessionFee {
  feeId?: string;
  feeCents?: string;
  restaurantId?: string;
}

/**
 * A session's payment landed: its fee is ours. Throws on failure, so the
 * webhook answers Stripe with an error and Stripe sends the event again.
 *
 * A session whose reservation row is gone still charged what it charged: the
 * fee is recorded from what the session carries, once.
 */
export async function takeFee(session: Stripe.Checkout.Session, fee: SessionFee): Promise<void> {
  const db = createAdminClient();
  const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  if (fee.feeId) {
    const { data, error } = await db.rpc("take_platform_fee", {
      p_fee: fee.feeId,
      p_intent: intent,
      p_charge_cents: session.amount_total ?? 0,
    });
    if (error) throw new Error(`Could not record the platform fee: ${error.message}`);
    if (data === true) return;
  }
  const charged = feeChargedBy(session, fee);
  if (!charged) return;
  const { error } = await db.rpc("record_session_fee", {
    p_restaurant: charged.restaurantId,
    p_ref: charged.ref,
    p_cents: charged.cents,
    p_intent: intent,
    p_charge_cents: session.amount_total ?? 0,
  });
  if (error) throw new Error(`Could not record the platform fee: ${error.message}`);
}

/**
 * The fee a session charged when there is no reservation to take: only what
 * the session itself carries (`fee_cents`, `restaurant_id`), counted once
 * under `session:<id>`. A session opened before the ledger carries neither,
 * and none can be open: no restaurant could take cards when the ledger went
 * live, and its migration refuses to apply while one can.
 */
function feeChargedBy(
  session: Stripe.Checkout.Session,
  fee: SessionFee,
): { restaurantId: string; cents: number; ref: string } | null {
  const cents = Number(fee.feeCents ?? 0);
  return fee.restaurantId && cents > 0 ? { restaurantId: fee.restaurantId, cents, ref: `session:${session.id}` } : null;
}

/** Whether a fee under `ref` is still reserved: a checkout for it is open or being opened. */
export async function feeRefOpen(restaurantId: string, ref: string): Promise<boolean> {
  const { data, error } = await createAdminClient().from("platform_fees").select("id")
    .eq("restaurant_id", restaurantId).eq("ref", ref).eq("status", "open").limit(1);
  if (error) throw new Error(`Could not read the share's fee: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Before a share opens a new session carrying its slice of the fee: the one
 * it opened before is expired at Stripe and its reservation released, so a
 * share never has two payable sessions — one of them fee-free. Answers
 * "paid" when that session was already paid, and throws when Stripe's answer
 * is unknown, so no second fee-bearing session is made.
 */
export async function retirePriorShareSession(
  restaurantId: string,
  ref: string,
  expire: (sessionId: string) => Promise<{ status: string | null }>,
  retrieve: (sessionId: string) => Promise<{ status: string | null }>,
): Promise<"none" | "retired" | "paid"> {
  const db = createAdminClient();
  const { data: prior, error } = await db.from("platform_fees").select("id, stripe_session_id")
    .eq("restaurant_id", restaurantId).eq("ref", ref).eq("status", "open").maybeSingle();
  if (error) throw new Error(`Could not read the share's fee: ${error.message}`);
  if (!prior?.stripe_session_id) return "none";
  let status: string | null;
  try {
    status = (await expire(prior.stripe_session_id)).status;
  } catch {
    // Not open any more — read what it became instead.
    status = (await retrieve(prior.stripe_session_id)).status;
  }
  if (status === "complete") return "paid";
  if (status !== "expired") throw new Error(`The share's earlier session is ${status}`);
  await releaseFee(prior.id);
  return "retired";
}

/** Which Stripe session a reservation's fee rides on, so a reopened share can retire it. */
export async function attachFeeSession(hold: FeeHold, sessionId: string): Promise<void> {
  if (!hold.id) return;
  const { error } = await createAdminClient().from("platform_fees")
    .update({ stripe_session_id: sessionId }).eq("id", hold.id);
  if (error) console.error("platform fee: its session could not be noted", error);
}

/** Stripe's expiry for a session nobody paid. */
export async function releaseSessionFee(session: Stripe.Checkout.Session): Promise<void> {
  await releaseFee(session.metadata?.fee_id);
}
