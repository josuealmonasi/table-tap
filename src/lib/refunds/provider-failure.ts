import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/** The refund events a Connect endpoint can receive for a refund that failed later. */
export const REFUND_FAILURE_EVENTS = new Set(["refund.failed", "refund.updated", "charge.refund.updated"]);
const FAILED = new Set(["failed", "canceled"]);

/**
 * Stripe failed a refund it first reported as succeeded: the diner has not got
 * the money back. The row goes back to "failed", where the bills page already
 * offers a retry, and the owner sees it in the activity log (audit O, finding 1).
 * Replays and out-of-order events are handled in SQL (audit P).
 *
 * A read or write error throws, so the webhook answers 500 and Stripe sends
 * the event again rather than the failure being lost.
 */
export async function reopenFailedRefund(refund: Stripe.Refund, account: string | undefined): Promise<void> {
  if (!account || !FAILED.has(refund.status ?? "")) return;
  const intent = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  if (!intent) return;
  const db = createAdminClient();
  const { data: restaurant, error } = await db.from("restaurants").select("id")
    .eq("stripe_account_id", account).maybeSingle();
  if (error) throw new Error(`Could not find the restaurant for a failed refund: ${error.message}`);
  if (!restaurant) return;
  // The owner's activity line is written by the same transaction, so a
  // replay can neither lose it nor write it twice (audit P, finding 6).
  const { error: reverseError } = await db.rpc("reverse_failed_refund_v2", {
    p_restaurant: restaurant.id, p_intent: intent, p_refund: refund.id, p_status: refund.status,
    p_cents: refund.amount, p_currency: refund.currency.toUpperCase(),
  });
  if (reverseError) throw new Error(`Could not reopen a failed refund: ${reverseError.message}`);
}
