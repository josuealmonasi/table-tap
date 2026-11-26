import { checkoutPageRpc } from "@/lib/checkout-page-rpc";
import { prepareSplitSlots } from "@/lib/split-slots-attempt";
import { retireSplitAttempt } from "@/lib/split-slots-lifecycle";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordDinerCheckout, requireVerifiedCheckout, stripeLiveMode } from "@/lib/diner-checkout";
import { releaseFee, stripeRefusedOutright } from "@/lib/platform-fee";
import { COUPON_CHANGED_SQLSTATE, type CouponQuote } from "@/lib/coupon-service";

export interface AttemptQuote {
  restaurantId: string; stripeAccount: string; currency: string; amountCents: number;
  orderIds: string[]; payableIds: string[]; scopeKey: string;
  payerMemberId?: string;
  entitlements?: Record<string, number>; discounts?: Record<string, number>; coupon?: CouponQuote;
  foodPrincipal: number;
}
/** A SQL rejection proves that this request never acquired a payable scope. */
export class DinerAttemptRejected extends Error {}
/** Another phone's page already holds these orders (`checkout_scope_busy`). */
export class DinerScopeBusy extends DinerAttemptRejected {}
export class DinerCouponChanged extends DinerAttemptRejected {}
class DinerAttemptExpired extends Error {}
/** Stripe refused the saved request outright and the attempt was closed; `cause` is Stripe's answer. */
class DinerAttemptRefused extends DinerAttemptExpired {}
interface AttemptRecord {
  id: string; restaurant_id: string; stripe_account_id: string; currency: string;
  amount_cents: number; order_ids: string[]; stripe_session_id: string | null;
  idempotency_key: string; stripe_params: Stripe.Checkout.SessionCreateParams;
  created_at?: string;
}
/** Stripe keeps an idempotency key at least 24 hours; the same margin as `whole-bill-pages`. */
const KEY_WINDOW_MS = 23 * 3600 * 1000;

/**
 * Durable proof that this attempt never produced a session: no page was ever
 * bound, and replaying its saved key was refused outright. Within the key's
 * life, a session made under it would have been replayed instead of refused.
 * An attempt this request just opened needs no window; an older one does.
 */
function neverMadeASession(attempt: AttemptRecord, error: unknown, justOpened: boolean): boolean {
  if (attempt.stripe_session_id || !stripeRefusedOutright(error)) return false;
  if (justOpened) return true;
  const age = Date.now() - new Date(attempt.created_at ?? "").getTime();
  return Number.isFinite(age) && age >= 0 && age < KEY_WINDOW_MS;
}

/** Give back what a never-created page held: share, coupon and fee. */
async function closeRefusedAttempt(attempt: AttemptRecord): Promise<void> {
  if (attempt.stripe_params?.metadata?.split_model === "2") {
    await retireSplitAttempt(attempt.restaurant_id, attempt.id);
    return;
  }
  await finishAttempt(attempt.id, false);
  await releaseFee(String(attempt.stripe_params?.metadata?.fee_id ?? ""));
}

async function deliver(stripe: Stripe, attempt: AttemptRecord, justOpened = false): Promise<Stripe.Checkout.Session> {
  const options = { stripeAccount: attempt.stripe_account_id };
  await prepareSplitSlots(attempt);
  // The full request is durable too: a retry must not change its tip, fee or expiry.
  let session: Stripe.Checkout.Session;
  try {
    session = attempt.stripe_session_id
      ? await stripe.checkout.sessions.retrieve(attempt.stripe_session_id, {}, options)
      : await stripe.checkout.sessions.create(attempt.stripe_params, { ...options, idempotencyKey: attempt.idempotency_key });
  } catch (error) {
    // A timeout, 409 or 429 can still have created a payable session: keep its
    // scope, coupon and fee reserved; the next request replays the same key.
    if (!neverMadeASession(attempt, error, justOpened)) throw error;
    // A saved request Stripe will never accept again (its expiry passed, say)
    // is retired here, so the caller quotes a fresh attempt with a new key and
    // a new expiry instead of replaying the refused one forever (bl43 #3).
    await closeRefusedAttempt(attempt);
    throw new DinerAttemptRefused("Stripe refused the saved checkout; the bill can be quoted again", { cause: error });
  }
  await recordDinerCheckout(session, {
    restaurantId: attempt.restaurant_id, stripeAccount: attempt.stripe_account_id,
    currency: attempt.currency, amountCents: attempt.amount_cents, orderIds: attempt.order_ids, attemptId: attempt.id,
  }, () => stripe.checkout.sessions.expire(session.id, {}, options));
  if (session.status === "expired") {
    if (attempt.stripe_params?.metadata?.split_model === "2") {
      await retireSplitAttempt(attempt.restaurant_id, attempt.id);
    } else await finishAttempt(attempt.id, false);
    throw new DinerAttemptExpired("Checkout expired; the bill can be quoted again");
  }
  if (session.status !== "open" || !session.url) throw new Error("Checkout payment is being recorded");
  return session;
}

/** Reopen the same payment page, even when the first response was lost. */
export async function resumeDinerAttempt(stripe: Stripe, restaurantId: string, scopeKey: string, attemptId?: string): Promise<Stripe.Checkout.Session | null> {
  let query = createAdminClient().from("diner_checkouts").select("*")
    .eq("restaurant_id", restaurantId).eq("scope_key", scopeKey).eq("status", "open");
  if (attemptId) query = query.eq("id", attemptId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Could not read checkout attempt: ${error.message}`);
  if (!data) return null;
  try { return await deliver(stripe, data as AttemptRecord); }
  catch (error) {
    if (error instanceof DinerAttemptExpired) return null;
    throw error;
  }
}

/** One transaction owns the financial scope, coupon and frozen net entitlements, regardless of fees. */
export async function openDinerAttempt(stripe: Stripe, params: Stripe.Checkout.SessionCreateParams, quote: AttemptQuote): Promise<Stripe.Checkout.Session> {
  const id = randomUUID();
  const record = {
    id, restaurant_id: quote.restaurantId, stripe_account_id: quote.stripeAccount,
    currency: quote.currency.toUpperCase(), amount_cents: quote.amountCents, livemode: stripeLiveMode(),
    order_ids: [...new Set(quote.orderIds)], payable_order_ids: quote.payableIds, scope_key: quote.scopeKey,
    payer_member_id: quote.payerMemberId,
    idempotency_key: `diner:${id}`, stripe_params: params, metadata: params.metadata ?? {},
    entitlements: quote.entitlements ?? {}, order_discounts: quote.discounts ?? {},
    coupon_id: quote.coupon?.id ?? null, coupon_quote: quote.coupon,
    food_principal: quote.foodPrincipal,
  };
  const { data, error } = await checkoutPageRpc("diner_checkout_open", { p_record: record }, {
    orderIds: record.order_ids, includeParts: params.metadata?.split_model !== "2",
  });
  if (data?.outcome === "paying") {
    // The quote acquired no scope. Sending it to Stripe would open a page
    // that the database refused to own, alongside the unresolved first one.
    await releaseFee(String(params.metadata?.fee_id ?? ""));
    // Another phone's page on these orders is being paid: the same answer as a busy scope.
    throw new DinerScopeBusy("Could not open checkout attempt: paying");
  }
  if (error) {
    // A database timeout can also have committed. Only a SQL error proves
    // rollback; releasing an uncertain fee could reopen the monthly ceiling.
    if (error.code === COUPON_CHANGED_SQLSTATE || /^(22|23|40|42|P0)/.test(error.code ?? "")) {
      await releaseFee(String(params.metadata?.fee_id ?? ""));
      if (error.code === COUPON_CHANGED_SQLSTATE) throw new DinerCouponChanged(`Could not open checkout attempt: ${error.message}`);
      const Rejection = error.message === "checkout_scope_busy" ? DinerScopeBusy : DinerAttemptRejected;
      throw new Rejection(`Could not open checkout attempt: ${error.message}`);
    }
    throw new Error(`Could not open checkout attempt: ${error.message}`);
  }
  const attempt = data as AttemptRecord;
  if (attempt.id !== id) await releaseFee(String(params.metadata?.fee_id ?? ""));
  try {
    return await deliver(stripe, attempt, attempt.id === id);
  } catch (error) {
    // Callers read Stripe's own refusal (e.g. an amount below the minimum).
    if (error instanceof DinerAttemptRefused) throw error.cause;
    throw error;
  }
}

async function finishAttempt(id: string, paid: boolean): Promise<void> {
  const { error } = await createAdminClient().rpc("finish_diner_checkout", { p_attempt: id, p_paid: paid });
  if (error) throw new Error(`Could not finish checkout attempt: ${error.message}`);
}

/** Called only after provenance verification, or after our own Stripe request proves expiry. */
export async function finishDinerCheckout(session: Stripe.Checkout.Session, paid: boolean): Promise<void> {
  requireVerifiedCheckout(session);
  const { data, error } = await createAdminClient().from("diner_checkouts").select("id")
    .eq("stripe_session_id", session.id).single();
  if (error || !data) throw new Error("Could not find checkout attempt");
  await finishAttempt(data.id, paid);
}
