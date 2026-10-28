import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";

export interface ReturnCharge {
  id: string; source: string; status: string; currency: string;
  stripe_account_id: string; stripe_payment_intent: string;
}
export interface SavedEvidence {
  id: string; operation_id?: string; attempt_no?: number; idempotency_key?: string; origin?: string; attribution_ref?: string;
  stripe_refund_id: string | null; amount: number; currency: string;
  stripe_account_id: string; stripe_payment_intent: string;
}
export const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function verifiedRefund(refund: Stripe.Refund, operation: ReturnCharge): boolean {
  const intent = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  return Boolean(refund.id && intent === operation.stripe_payment_intent
    && refund.currency?.toUpperCase() === operation.currency && Number.isSafeInteger(refund.amount) && refund.amount > 0
    && ["succeeded", "pending", "requires_action", "failed", "canceled"].includes(refund.status ?? ""));
}
export function refundEvidence(refund: Stripe.Refund, operation: ReturnCharge) {
  return { id: refund.id, amount_cents: refund.amount, currency: refund.currency.toUpperCase(),
    payment_intent: operation.stripe_payment_intent, account: operation.stripe_account_id, status: refund.status };
}
/** Old cancellations tagged only their operation. Exact full evidence may
 * recover their first saved request; a partial tag never covers that request. */
export function legacyRefund(refund: Stripe.Refund, saved: SavedEvidence): boolean {
  return Boolean(saved.origin !== "manual" && saved.attempt_no === 1 && saved.idempotency_key?.startsWith("cancel-")
    && refund.metadata?.refund_operation === saved.operation_id && !refund.metadata?.refund_attempt
    && !refund.metadata?.return_attribution && refund.amount === Math.round(Number(saved.amount) * 100));
}
export async function returnCharge(restaurant: string, id: string): Promise<ReturnCharge | null> {
  const { data, error } = await createAdminClient().from("refund_operations")
    .select("id, source, status, currency, stripe_account_id, stripe_payment_intent")
    .eq("restaurant_id", restaurant).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not read the return: ${error.message}`);
  return data as ReturnCharge | null;
}

/** Read the whole charge before opening an attempt. Untagged money must never
 * disappear behind an app POST that would give the same money back twice. */
export async function discoverReturn(client: Stripe, restaurant: string, operation: ReturnCharge, actor: string) {
  const db = createAdminClient();
  const attempts = await everyRow<SavedEvidence>((a, b) => db.from("refund_attempts")
    .select("id, operation_id, attempt_no, idempotency_key, origin, attribution_ref, stripe_refund_id, amount, currency, stripe_account_id, stripe_payment_intent")
    .eq("restaurant_id", restaurant).eq("stripe_payment_intent", operation.stripe_payment_intent)
    .eq("stripe_account_id", operation.stripe_account_id).order("id").range(a, b), "the charge's saved refund attempts");
  const dues = await everyRow<{ stripe_refund_id: string | null }>((a, b) => db.from("refund_due_attempts")
    .select("id, stripe_refund_id").eq("restaurant_id", restaurant)
    .eq("stripe_payment_intent", operation.stripe_payment_intent).eq("stripe_account_id", operation.stripe_account_id)
    .order("id").range(a, b), "the charge's duplicate refunds");
  const legacy = await everyRow<{ stripe_refund_id: string | null }>((a, b) => db.from("refunds_due")
    .select("id, stripe_refund_id").eq("restaurant_id", restaurant)
    .eq("stripe_payment_intent", operation.stripe_payment_intent).eq("stripe_account_id", operation.stripe_account_id)
    .order("id").range(a, b), "the charge's historical duplicate refunds");
  const coverage = await everyRow<{ stripe_refund_id: string }>((a, b) => db.from("refund_due_coverage")
    .select("stripe_refund_id").eq("restaurant_id", restaurant).order("due_id").order("stripe_refund_id").range(a, b), "the saved duplicate coverage");
  const refunds: Stripe.Refund[] = [];
  for await (const refund of client.refunds.list({ payment_intent: operation.stripe_payment_intent, limit: 100 },
    { stripeAccount: operation.stripe_account_id })) refunds.push(refund);
  let blocked = false;
  for (const refund of refunds) {
    if (!verifiedRefund(refund, operation)) { blocked = true; continue; }
    if (["failed", "canceled"].includes(refund.status!)) continue;
    const saved = attempts.find(a => a.stripe_refund_id === refund.id || a.origin !== "manual" && a.id === refund.metadata?.refund_attempt || legacyRefund(refund, a));
    if (saved?.origin === "manual" && saved.operation_id === operation.id && uuid(saved.attribution_ref)) {
      const { data, error } = await db.rpc("record_order_return_coverage_v1", {
        p_restaurant: restaurant, p_operation: operation.id, p_actor: actor,
        p_refunds: [refundEvidence(refund, operation)], p_attribution_ref: saved.attribution_ref,
      });
      if (error) throw new Error(`Could not record manual refund coverage: ${error.message}`);
      if (!["completed", "partial"].includes(data?.outcome)) blocked = true;
    } else if (!saved && ![...dues, ...legacy, ...coverage].some(d => d.stripe_refund_id === refund.id)) {
      // A legacy operation-only tag cannot say how much of a promise it covers.
      blocked = true;
    }
  }
  return { refunds, blocked };
}
