import { unpackOrderIds } from "@/lib/stripe-limits";
import { dinerCheckoutOrders } from "@/lib/diner-checkout-orders";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDinerCurrency } from "@/lib/diner-currency";

export interface DinerCheckoutRecord {
  stripe_session_id: string;
  restaurant_id: string;
  stripe_account_id: string;
  livemode: boolean;
  currency: string;
  amount_cents: number;
  metadata: Record<string, string>;
  /** Includes the frozen split's food as well as this diner's later orders. */
  order_ids: string[];
}
export interface ConnectContext { account?: string; livemode: boolean }
const verified = new WeakMap<Stripe.Checkout.Session, DinerCheckoutRecord>();

/** Derive the mode from the key, never NODE_ENV: local testing can use a live key. */
export function stripeLiveMode(): boolean {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (/^(sk|rk)_live_/.test(key)) return true;
  if (/^(sk|rk)_test_/.test(key)) return false;
  throw new Error("Cannot determine the Stripe secret key's mode");
}

function sameMetadata(a: Record<string, string> | null, b: Record<string, string>): boolean {
  const keys = Object.keys(a ?? {});
  return keys.length === Object.keys(b).length && keys.every(key => a![key] === b[key]);
}

/** Refuse a stale or cross-tenant scope before any fee, coupon, stock or money write. */
async function checkScope(record: DinerCheckoutRecord, allowMissing = false): Promise<void> {
  const db = createAdminClient();
  const { data: restaurant, error } = await db.from("restaurants").select("stripe_account_id")
    .eq("id", record.restaurant_id).single();
  if (error || restaurant?.stripe_account_id !== record.stripe_account_id) throw new Error("Checkout account does not match the restaurant");
  if (!record.order_ids.length) throw new Error("Checkout has no frozen orders");
  const orders = await dinerCheckoutOrders(record.order_ids);
  if ((!allowMissing && orders.length !== record.order_ids.length) || orders.some(o =>
    o.restaurant_id !== record.restaurant_id || o.currency !== record.currency)) throw new Error("Checkout order scope does not match");
}

/**
 * Save the session ID Stripe returned before exposing its payment URL. Matching
 * metadata alone is unsafe: a connected owner can copy it onto their own session.
 */
export async function recordDinerCheckout(
  session: Stripe.Checkout.Session,
  expected: { restaurantId: string; stripeAccount: string; currency: string; amountCents: number; orderIds: string[] },
  expire: () => Promise<unknown>,
): Promise<void> {
  try {
    const record: DinerCheckoutRecord = {
      stripe_session_id: session.id, restaurant_id: expected.restaurantId, stripe_account_id: expected.stripeAccount,
      currency: expected.currency.toUpperCase(), amount_cents: expected.amountCents, livemode: stripeLiveMode(),
      metadata: { ...session.metadata }, order_ids: [...new Set(expected.orderIds)],
    };
    if (!isDinerCurrency(record.currency) || session.mode !== "payment" || session.livemode !== record.livemode
      || session.currency !== record.currency.toLowerCase() || session.amount_total !== record.amount_cents
      || record.metadata.restaurant_id !== record.restaurant_id) throw new Error("Stripe created a different checkout than requested");
    await checkScope(record);
    const { error } = await createAdminClient().from("diner_checkouts").insert(record);
    if (error) throw new Error(`Could not save checkout provenance: ${error.message}`);
  } catch (error) {
    // Never expose a payable page whose money we cannot authenticate later.
    await expire().catch(err => console.error("Unrecorded checkout could not be expired", err));
    throw error;
  }
}

/** Signature verification authenticates Stripe, while this authenticates our checkout. */
export async function verifyDinerCheckout(session: Stripe.Checkout.Session, context?: ConnectContext): Promise<void> {
  if (!context?.account || context.livemode !== stripeLiveMode() || session.livemode !== context.livemode) {
    throw new Error("Checkout event account or mode does not match");
  }
  const { data, error } = await createAdminClient().from("diner_checkouts").select("*")
    .eq("stripe_session_id", session.id).maybeSingle();
  const record = data as DinerCheckoutRecord | null;
  // No metadata fallback for pre-deploy sessions. There are no connected production accounts yet.
  if (error || !record || record.stripe_session_id !== session.id || record.stripe_account_id !== context.account
    || record.livemode !== context.livemode || !isDinerCurrency(record.currency) || session.mode !== "payment"
    || session.amount_total !== record.amount_cents || session.currency !== record.currency.toLowerCase()
    || !sameMetadata(session.metadata, record.metadata)) throw new Error("Checkout provenance does not match");
  // An earlier expiry may already have removed its pending order. The frozen
  // record still authenticates the retry; every surviving order must agree.
  await checkScope(record, session.payment_status !== "paid");
  if (session.payment_status === "paid") {
    const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!intent) throw new Error("Paid checkout has no payment intent");
    // The receipt trigger reads the frozen currency/account from this row,
    // including pooled split and account receipts after a menu currency change.
    const { error: intentError } = await createAdminClient().from("diner_checkouts")
      .update({ stripe_payment_intent: intent }).eq("stripe_session_id", session.id);
    if (intentError) throw new Error(`Could not bind the checkout payment: ${intentError.message}`);
  }
  verified.set(session, record);
}

/** Lower-level exports cannot bypass the webhook's check, even when called directly. */
export function requireVerifiedCheckout(session: Stripe.Checkout.Session, ids?: string[]): void {
  const record = verified.get(session);
  if (!record || !sameMetadata(session.metadata, record.metadata)
    || session.amount_total !== record.amount_cents || session.currency !== record.currency.toLowerCase()) {
    throw new Error("Checkout provenance was not verified");
  }
  const asked = record.metadata.order_id ? [record.metadata.order_id] : unpackOrderIds(record.metadata);
  if (ids?.some(id => !asked.includes(id))) throw new Error("Orders differ from verified checkout scope");
}
