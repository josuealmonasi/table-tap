import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";

export interface ReturnCharge {
  id: string; source: string; status: string; currency: string;
  stripe_account_id: string; stripe_payment_intent: string;
}
interface SavedEvidence {
  id: string; operation_id?: string; attempt_no?: number; idempotency_key?: string; origin?: string; attribution_ref?: string;
  stripe_refund_id: string | null; amount: number;
}
export const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function verifiedRefund(refund: Stripe.Refund, operation: ReturnCharge): boolean {
  const intent = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  return Boolean(refund.id && intent === operation.stripe_payment_intent
    && refund.currency?.toUpperCase() === operation.currency && Number.isSafeInteger(refund.amount) && refund.amount > 0
    && ["succeeded", "pending", "requires_action", "failed", "canceled"].includes(refund.status ?? ""));
}
export function refundEvidence(refund: Stripe.Refund, operation: ReturnCharge, origin: "app" | "manual" = "app") {
  // A manual refund found tomorrow keeps Stripe's date. App attempts use
  // the verification time because they may have been pending when created.
  return { id: refund.id, amount_cents: refund.amount, currency: refund.currency.toUpperCase(),
    payment_intent: operation.stripe_payment_intent, account: operation.stripe_account_id, status: refund.status,
    ...(origin === "manual" && refund.status === "succeeded" && { succeeded_at: refund.created }) };
}
/** Old cancellations tagged only their operation. Exact full evidence may
 * recover their first saved request; a partial tag never covers that request. */
function legacyRefund(refund: Stripe.Refund, saved: SavedEvidence): boolean {
  return Boolean(saved.origin !== "manual" && saved.attempt_no === 1 && saved.idempotency_key?.startsWith("cancel-")
    && refund.metadata?.refund_operation === saved.operation_id && !refund.metadata?.refund_attempt
    && !refund.metadata?.return_attribution && refund.amount === Math.round(Number(saved.amount) * 100));
}

export function refundForAttempt(refund: Stripe.Refund, attempt: SavedEvidence): boolean {
  return attempt.stripe_refund_id === refund.id
    || attempt.origin !== "manual" && (attempt.id === refund.metadata?.refund_attempt || legacyRefund(refund, attempt));
}

async function listChargeRefunds(client: Stripe, operation: ReturnCharge): Promise<Stripe.Refund[]> {
  const refunds: Stripe.Refund[] = [];
  for await (const refund of client.refunds.list({ payment_intent: operation.stripe_payment_intent, limit: 100 },
    { stripeAccount: operation.stripe_account_id })) refunds.push(refund);
  return refunds;
}

function savedAttempts(restaurant: string, operation: ReturnCharge) {
  const db = createAdminClient();
  return everyRow<SavedEvidence>((a, b) => db.from("refund_attempts")
    .select("id, operation_id, attempt_no, idempotency_key, origin, attribution_ref, stripe_refund_id, amount")
    .eq("restaurant_id", restaurant).eq("stripe_payment_intent", operation.stripe_payment_intent)
    .eq("stripe_account_id", operation.stripe_account_id).order("id").range(a, b), "the charge's saved refund attempts");
}

interface DueAttempt { id: string; due_id: string; attempt_no: number; stripe_refund_id: string | null }

function savedDueAttempts(restaurant: string, operation: ReturnCharge) {
  const db = createAdminClient();
  return everyRow<DueAttempt>((a, b) => db.from("refund_due_attempts")
    .select("id, due_id, attempt_no, stripe_refund_id").eq("restaurant_id", restaurant)
    .eq("stripe_payment_intent", operation.stripe_payment_intent).eq("stripe_account_id", operation.stripe_account_id)
    .order("id").range(a, b), "the charge's duplicate refunds");
}

/** Read the provider last so local evidence lookups do not widen the POST window. */
export async function recheckChargeRefunds(
  client: Stripe, restaurant: string, operation: ReturnCharge, earlier: Stripe.Refund[], attempt: SavedEvidence,
) {
  const [attempts, dues] = await Promise.all([savedAttempts(restaurant, operation), savedDueAttempts(restaurant, operation)]);
  const seen = new Set(earlier.map(refund => refund.id));
  const refunds = await listChargeRefunds(client, operation);
  const foreign = refunds.find(refund => !seen.has(refund.id) && !(verifiedRefund(refund, operation) && (
    refundForAttempt(refund, attempt)
    || attempts.some(saved => saved.origin !== "manual" && refundForAttempt(refund, saved))
    || dues.some(due => due.due_id === refund.metadata?.refund_due && (due.id === refund.metadata?.refund_due_attempt
      || (due.attempt_no === 1 && !refund.metadata?.refund_due_attempt)))
  )));
  return { refunds, foreign };
}

export async function returnCharge(restaurant: string, id: string): Promise<ReturnCharge | null> {
  const { data, error } = await createAdminClient().from("refund_operations")
    .select("id, source, status, currency, stripe_account_id, stripe_payment_intent")
    .eq("restaurant_id", restaurant).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not read the return: ${error.message}`);
  return data as ReturnCharge | null;
}

export async function retireUnsentReturn(restaurant: string, operation: string, attempt: string, actor: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("retire_unsent_refund_attempt_v1", {
    p_restaurant: restaurant, p_operation: operation, p_attempt: attempt, p_actor: actor,
  });
  if (error) throw new Error(`Could not retire the unsent refund attempt: ${error.message}`);
  return data === true;
}

/** The manager's Check action can clear an expired, unsent attempt so manual
 * attribution can proceed. An in-flight or recorded refund stays protected. */
export async function checkReviewedReturn(client: Stripe, restaurant: string, operation: ReturnCharge, actor: string): Promise<void> {
  const { data: attempt, error } = await createAdminClient().from("refund_attempts")
    .select("id, operation_id, attempt_no, idempotency_key, amount, stripe_refund_id, provider_status, created_at")
    .eq("restaurant_id", restaurant).eq("operation_id", operation.id).eq("origin", "app")
    .eq("stripe_payment_intent", operation.stripe_payment_intent).eq("stripe_account_id", operation.stripe_account_id)
    .order("attempt_no", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Could not read the refund attempt under review: ${error.message}`);
  if (!attempt || attempt.stripe_refund_id || attempt.provider_status
    || !(Date.now() - Date.parse(attempt.created_at) >= 24 * 3600000)) return;
  const refunds = await listChargeRefunds(client, operation);
  if (refunds.every(refund => verifiedRefund(refund, operation) && !refundForAttempt(refund, attempt))) {
    await retireUnsentReturn(restaurant, operation.id, attempt.id, actor);
  }
}

export async function flagReturnForReview(
  restaurant: string, operation: string, attempt: string, actor: string, refund: string,
): Promise<void> {
  const db = createAdminClient();
  const reason = `New external Stripe refund ${refund} found before sending; manual reconciliation requested by ${actor}`;
  console.error("Order refund needs manual reconciliation", operation, attempt, refund);
  const { error } = await db.from("refund_operations").update({ status: "review" })
    .eq("restaurant_id", restaurant).eq("id", operation).eq("source", "stripe").eq("status", "processing");
  if (error) throw new Error(`Could not flag the return for review: ${error.message}`);
  const { error: auditError } = await db.from("refund_attempts").update({ last_error: reason })
    .eq("restaurant_id", restaurant).eq("operation_id", operation).eq("id", attempt).eq("origin", "app")
    .is("stripe_refund_id", null).is("provider_status", null);
  if (auditError) throw new Error(`Could not record the refund review reason: ${auditError.message}`);
}

/** Read the whole charge before opening an attempt. Untagged money must never
 * disappear behind an app POST that would give the same money back twice. */
export async function discoverReturn(client: Stripe, restaurant: string, operation: ReturnCharge, actor: string) {
  const db = createAdminClient();
  const attempts = await savedAttempts(restaurant, operation);
  const dues = await savedDueAttempts(restaurant, operation);
  const legacy = await everyRow<{ stripe_refund_id: string | null }>((a, b) => db.from("refunds_due")
    .select("id, stripe_refund_id").eq("restaurant_id", restaurant)
    .eq("stripe_payment_intent", operation.stripe_payment_intent).eq("stripe_account_id", operation.stripe_account_id)
    .order("id").range(a, b), "the charge's historical duplicate refunds");
  const coverage = await everyRow<{ stripe_refund_id: string }>((a, b) => db.from("refund_due_coverage")
    .select("stripe_refund_id").eq("restaurant_id", restaurant).order("due_id").order("stripe_refund_id").range(a, b), "the saved duplicate coverage");
  const refunds = await listChargeRefunds(client, operation);
  let blocked = false;
  for (const refund of refunds) {
    if (!verifiedRefund(refund, operation)) { blocked = true; continue; }
    if (["failed", "canceled"].includes(refund.status!)) continue;
    const saved = attempts.find(a => refundForAttempt(refund, a));
    if (saved?.origin === "manual" && saved.operation_id === operation.id && uuid(saved.attribution_ref)) {
      const { data, error } = await db.rpc("record_order_return_coverage_v1", {
        p_restaurant: restaurant, p_operation: operation.id, p_actor: actor,
        p_refunds: [refundEvidence(refund, operation, "manual")], p_attribution_ref: saved.attribution_ref,
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
