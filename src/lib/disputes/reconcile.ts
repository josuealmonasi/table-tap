import type Stripe from "stripe";
import { disputeOwnership } from "./ownership";
import type { DisputeDb, DisputeEvent } from "./types";

const identity = (value: string | { id: string } | null): string | null => typeof value === "string" ? value : value?.id ?? null;

/** A lease serializes all notifications for one case. SQL fences an expired
 * worker before any case or movement write; retries never overwrite money. */
export async function reconcileDispute(db: DisputeDb, client: Stripe, eventId: string): Promise<boolean> {
  const claim = await db.rpc("claim_stripe_dispute_event", { p_event: eventId });
  if (claim.error) throw new Error(`Dispute claim failed: ${claim.error.message}`);
  const event = claim.data as DisputeEvent | null;
  if (!event) return false;
  try {
    const options = { stripeAccount: event.stripe_account_id };
    const dispute = await client.disputes.retrieve(event.stripe_dispute_id, options);
    if (dispute.id !== event.stripe_dispute_id || dispute.livemode !== event.livemode) throw new Error("Dispute identity mismatch");
    if (!Number.isSafeInteger(dispute.amount) || dispute.amount < 0) throw new Error("Invalid disputed amount");
    const charge = identity(dispute.charge);
    if (!charge) throw new Error("Dispute charge missing");
    let intent = identity(dispute.payment_intent);
    if (!intent) {
      const original = await client.charges.retrieve(charge, options);
      if (original.livemode !== event.livemode) throw new Error("Charge mode mismatch");
      intent = identity(original.payment_intent);
    }
    const owner = await disputeOwnership(db, event.stripe_account_id, event.livemode, intent);
    // Re-read each transaction under the original account. Expanded webhook
    // data and event names never establish signed amounts or invent a fee.
    const ids = new Set(dispute.balance_transactions.map(tx => tx.id));
    let cursor: string | undefined;
    const cursors = new Set<string>();
    for (;;) {
      const page = await client.balanceTransactions.list({ source: dispute.id, limit: 100,
        ...(cursor ? { starting_after: cursor } : {}) }, options);
      page.data.forEach(tx => ids.add(tx.id));
      if (!page.has_more) break;
      const next = page.data.at(-1)?.id;
      if (!next || cursors.has(next)) throw new Error("Incomplete dispute transactions");
      cursors.add(next);
      cursor = next;
    }
    const movements = [];
    for (const transactionId of ids) {
      const tx = await client.balanceTransactions.retrieve(transactionId, options);
      if (tx.id !== transactionId || identity(tx.source) !== dispute.id) throw new Error("Dispute transaction source mismatch");
      if (![tx.amount, tx.fee, tx.net].every(Number.isSafeInteger) || tx.amount - tx.fee !== tx.net) throw new Error("Dispute transaction arithmetic mismatch");
      if (tx.fee_details.some(fee => fee.currency.toUpperCase() !== tx.currency.toUpperCase())
        || tx.fee_details.reduce((sum, fee) => sum + fee.amount, 0) !== tx.fee) throw new Error("Unexplained dispute fee components");
      movements.push({ stripe_balance_transaction_id: tx.id, provider_type: tx.type,
        amount_minor: tx.amount, fee_minor: tx.fee, net_minor: tx.net, currency: tx.currency.toUpperCase(),
        provider_created_at: new Date(tx.created * 1000).toISOString(), fee_details: tx.fee_details });
    }
    const saved = await db.rpc("finish_stripe_dispute_event", { p_event: event.id, p_claim: event.claim_token,
      p_case: { restaurant_id: owner.restaurantId, stripe_charge_id: charge, stripe_payment_intent: intent,
        order_id: owner.orderIds.length === 1 ? owner.orderIds[0] : null, diner_checkout_id: owner.checkoutId,
        account_checkout_id: owner.accountCheckoutId, amount_minor: dispute.amount, currency: dispute.currency.toUpperCase(),
        status: dispute.status, reason: dispute.reason, evidence_due_at: dispute.evidence_details.due_by ? new Date(dispute.evidence_details.due_by * 1000).toISOString() : null,
        provider_created_at: new Date(dispute.created * 1000).toISOString(), matched: owner.matched }, p_movements: movements });
    if (saved.error) throw new Error(`Dispute commit failed: ${saved.error.message}`);
    return saved.data === true;
  } catch (error) {
    const failed = await db.rpc("fail_stripe_dispute_event", { p_event: event.id, p_claim: event.claim_token,
      p_error: error instanceof Error ? error.message : String(error) });
    if (failed.error) console.error("Could not record dispute failure", failed.error.message);
    throw error;
  }
}
