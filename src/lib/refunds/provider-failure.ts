import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";

/** The refund events a Connect endpoint can receive for a refund that failed later. */
export const REFUND_FAILURE_EVENTS = new Set(["refund.failed", "refund.updated", "charge.refund.updated"]);
const FAILED = new Set(["failed", "canceled"]);

/**
 * Stripe failed a refund it first reported as succeeded: the diner has not got
 * the money back. The row goes back to "failed", where the bills page already
 * offers a retry, and the owner sees it in the activity log (audit O, finding 1).
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
  const { data: reopened, error: reverseError } = await db.rpc("reverse_failed_refund", {
    p_restaurant: restaurant.id, p_intent: intent, p_refund: refund.id, p_status: refund.status,
  });
  if (reverseError) throw new Error(`Could not reopen a failed refund: ${reverseError.message}`);
  // Only the call that reopened it says so, so a retried event is logged once.
  if (reopened !== "operation" && reopened !== "due") return;
  await logEvent({
    restaurantId: restaurant.id,
    actor: "Stripe",
    entity: reopened === "due" ? "bill" : "order",
    action: "refund_failed",
    detail: logDetail({ amount: (refund.amount / 100).toFixed(2), currency: refund.currency.toUpperCase() }),
  });
}
