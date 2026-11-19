import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { DISPUTE_EVENTS, type DisputeDb } from "./types";
import { reconcileDispute } from "./reconcile";

/** An enqueue failure must reach Stripe as non-2xx. Provider failures after
 * enqueue are safe to acknowledge: the existing recovery runner owns retry. */
export async function ingestDispute(event: Stripe.Event, db: DisputeDb = createAdminClient(), client: Stripe = stripe): Promise<void> {
  if (!DISPUTE_EVENTS.has(event.type)) return;
  if (!event.account) throw new Error("Connected dispute account missing");
  const dispute = event.data.object as Stripe.Dispute;
  if (dispute.object !== "dispute" || !dispute.id || dispute.livemode !== event.livemode) throw new Error("Invalid dispute notification");
  const { data, error } = await db.rpc("enqueue_stripe_dispute_event", {
    p_account: event.account, p_live: event.livemode, p_event: event.id, p_dispute: dispute.id,
    p_intent: typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id ?? null,
    p_type: event.type, p_created: new Date(event.created * 1000).toISOString(),
  });
  if (error || typeof data !== "string") throw new Error(`Dispute inbox failed: ${error?.message ?? "missing event id"}`);
  try { await reconcileDispute(db, client, data); }
  catch (error) { console.error("Dispute remains pending for scheduled recovery", event.id, error); }
}
