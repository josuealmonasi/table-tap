import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { orderFeeCents, type PlanLimits } from "@/lib/plan";
import { unpackOrderIds } from "@/lib/stripe-limits";

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
 * may have made the session anyway (Stripe calls those indeterminate), so its
 * fee stays counted until Stripe's expiry says otherwise.
 */
export function stripeRefusedOutright(err: unknown): boolean {
  const status = err && typeof err === "object" && "statusCode" in err ? Number((err as { statusCode?: unknown }).statusCode) : NaN;
  return status >= 400 && status < 500;
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
 * A session with no reservation to take — opened before the ledger existed,
 * or whose row is gone — still charged what it charged: the fee is recorded
 * from the session itself, once per order or session.
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
  const charged = await feeChargedBy(session, fee);
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
 * The fee a session charged, from the session and the rows it names: what we
 * now write on it (`fee_cents`), or what a session opened before the ledger
 * carried — `settle_fee` on a table's bill or a share, the order's own
 * `platform_fee`, an account checkout's `fee`.
 */
async function feeChargedBy(
  session: Stripe.Checkout.Session,
  fee: SessionFee,
): Promise<{ restaurantId: string; cents: number; ref: string } | null> {
  const db = createAdminClient();
  const meta = session.metadata ?? {};
  const pesos = (v: unknown) => Math.round(Number(v ?? 0) * 100);
  const ref = `session:${session.id}`;
  if (meta.account_checkout) {
    const { data } = await db.from("account_checkouts").select("restaurant_id, fee").eq("id", meta.account_checkout).maybeSingle();
    const cents = fee.feeCents ? Number(fee.feeCents) : pesos(data?.fee);
    return data && cents > 0 ? { restaurantId: fee.restaurantId ?? data.restaurant_id, cents, ref } : null;
  }
  if (meta.split_id) {
    const { data } = await db.from("bill_splits").select("restaurant_id").eq("id", meta.split_id).maybeSingle();
    const cents = fee.feeCents ? Number(fee.feeCents) : pesos(meta.settle_fee);
    return data && cents > 0 ? { restaurantId: fee.restaurantId ?? data.restaurant_id, cents, ref } : null;
  }
  const billOrders = unpackOrderIds(meta);
  const orderId = billOrders[0] ?? meta.order_id;
  if (!orderId) return null;
  const { data } = await db.from("orders").select("restaurant_id, platform_fee").eq("id", orderId).maybeSingle();
  if (!data) return null;
  if (billOrders.length) {
    const cents = fee.feeCents ? Number(fee.feeCents) : pesos(meta.settle_fee);
    return cents > 0 ? { restaurantId: fee.restaurantId ?? data.restaurant_id, cents, ref } : null;
  }
  // A diner's own order: keyed by the order, the same key the backfill uses,
  // so an order counted from its own history is never counted twice.
  const cents = fee.feeCents ? Number(fee.feeCents) : pesos(data.platform_fee);
  return cents > 0 ? { restaurantId: fee.restaurantId ?? data.restaurant_id, cents, ref: `order:${orderId}` } : null;
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
