import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;
interface FeeReturn {
  id: string;
  restaurant_id: string;
  stripe_payment_intent: string;
  stripe_account_id: string;
  stripe_fee_id: string;
  currency: string;
  amount_cents: number;
  idempotency_key: string;
  status: "prepared" | "dispatched" | "unresolved";
}
interface Transition { outcome: string; request?: FeeReturn; revision: number }

/**
 * Our share of the fee on a charge the restaurant refunded by hand.
 *
 * A refund made in the restaurant's own Stripe dashboard leaves our fee where
 * it is. This returns the part of it that belongs to the money given back —
 * all of it when the whole charge was paid twice.
 * One charge owns every fee return, including our order-refund recovery.
 */
export async function reconcileChargeFee(
  db: Db, client: Stripe, restaurant: string, intentId: string, account: string,
): Promise<boolean> {
  // Read before Stripe: a refund failing while we read moves the revision on,
  // and this snapshot is then refused instead of trusted (audit P, finding 2).
  async function revision(): Promise<number> {
    const { data, error } = await db.rpc("refund_fee_epoch", { p_restaurant: restaurant, p_intent: intentId });
    if (error || !Number.isSafeInteger(data)) throw new Error(`Could not read the fee verification epoch: ${error?.message ?? "no epoch"}`);
    return data;
  }
  let epoch = await revision();
  const { data: queued, error: queueError } = await db.from("fee_reconcile_queue").select("generation")
    .eq("restaurant_id", restaurant).eq("stripe_payment_intent", intentId).maybeSingle();
  if (queueError) throw new Error(`Could not read the fee reconciliation generation: ${queueError.message}`);
  // Never acknowledge a generation discovered after our provider snapshot.
  const generation: number | undefined = queued?.generation;
  async function ack(): Promise<boolean> {
    if (generation !== undefined) {
      const { error } = await db.rpc("ack_fee_reconcile", {
        p_restaurant: restaurant, p_intent: intentId, p_generation: generation,
      });
      if (error) throw new Error(`Could not acknowledge the returned fee: ${error.message}`);
    }
    return true;
  }
  async function transition(call: ReturnType<Db["rpc"]>, name: string): Promise<Transition> {
    const { data, error } = await call;
    if (error || !data || typeof data.outcome !== "string") throw new Error(`Could not ${name}: ${error?.message ?? "no outcome"}`);
    return data;
  }
  // Recording positive evidence moves the revision. Verify a fresh provider
  // snapshot afterwards; a manual refund can raise the target in between.
  for (let pass = 0; pass < 3; pass++) {
    if (pass) epoch = await revision();
    const intent = await client.paymentIntents.retrieve(intentId, { expand: ["latest_charge"] }, { stripeAccount: account });
    const charge = intent.latest_charge as Stripe.Charge | null;
    if (!charge?.amount) throw new Error("Could not verify the original charge for the returned fee");
    const feeId = typeof charge.application_fee === "string" ? charge.application_fee : charge.application_fee?.id;
    const fee = feeId ? await client.applicationFees.retrieve(feeId) : null;
    let refunded = 0;
    const refundIds: string[] = [];
    for await (const refund of client.refunds.list({ payment_intent: intentId, limit: 100 }, { stripeAccount: account })) {
      if (refund.status === "succeeded") { refunded += refund.amount; refundIds.push(refund.id); }
    }
    // Stripe's cumulative amount already includes our earlier requests. Adding
    // the ledger's successful rows here would return the same share twice.
    const target = fee ? Math.round(fee.amount * Math.min(refunded, charge.amount) / charge.amount) : 0;
    const { data: current, error } = await db.rpc("verify_refunded_platform_fee_v2", {
      p_restaurant: restaurant, p_intent: intentId, p_cents: fee?.amount_refunded ?? 0,
      p_target: target, p_refunds: fee ? refundIds : null, p_epoch: epoch,
    });
    if (error) throw new Error(`Could not reconcile the returned platform fee: ${error.message}`);
    // Stays pending; the next recovery reads Stripe again under the new epoch.
    if (current !== true) throw new Error("The returned fee changed while it was being verified");
    if (!fee || !feeId) return ack();
    const remainder = target - fee.amount_refunded;
    const prepared = await transition(db.rpc("prepare_fee_return", {
      p_restaurant: restaurant, p_intent: intentId, p_account: account, p_fee: feeId, p_currency: fee.currency.toUpperCase(),
      p_target: target, p_returned: fee.amount_refunded, p_revision: epoch,
    }), "prepare_fee_return");
    if (prepared.outcome === "stale") return false;
    if (prepared.outcome === "none") return ack();
    if (!["open", "prepared"].includes(prepared.outcome) || !Number.isSafeInteger(prepared.revision)) return false;
    const request = prepared.request;
    // Identity and cents are immutable. Never send a row for another account,
    // fee or currency using this charge's provider snapshot.
    if (!request || !request.id || !request.idempotency_key || request.restaurant_id !== restaurant || request.stripe_payment_intent !== intentId
      || request.stripe_account_id !== account || request.stripe_fee_id !== feeId
      || request.currency.toUpperCase() !== fee.currency.toUpperCase()
      || !Number.isSafeInteger(request.amount_cents) || request.amount_cents <= 0) return false;
    let prior: Stripe.FeeRefund | undefined;
    if (request.status === "dispatched" || request.status === "unresolved") {
      // Keys expire at Stripe. Only positive metadata evidence resolves an
      // unknown POST; absence never authorises a replacement request.
      for await (const made of client.applicationFees.listRefunds(feeId, { limit: 100 })) {
        if (made.metadata?.fee_return === request.id) {
          if (prior || made.amount !== request.amount_cents || made.currency.toUpperCase() !== request.currency.toUpperCase()) return false;
          prior = made;
        }
      }
    }
    if (!prior) {
      const claimed = await transition(db.rpc("claim_fee_return", {
        p_restaurant: restaurant, p_id: request.id, p_remainder: remainder, p_revision: prepared.revision,
      }), "claim_fee_return");
      if (!["claimed", "reclaimed"].includes(claimed.outcome)) return false;
      // Claim must return the very same immutable request and key.
      if (!claimed.request || claimed.request.id !== request.id || claimed.request.idempotency_key !== request.idempotency_key
        || claimed.request.amount_cents !== request.amount_cents || request.amount_cents > remainder) return false;
      prior = await client.applicationFees.createRefund(feeId, {
        amount: request.amount_cents, metadata: { fee_return: request.id },
      }, { idempotencyKey: request.idempotency_key });
    }
    if (!prior.id || prior.amount !== request.amount_cents || prior.metadata?.fee_return !== request.id
      || prior.currency.toUpperCase() !== request.currency.toUpperCase()) return false;
    const { data: recorded, error: recordError } = await db.rpc("record_fee_return", {
      p_restaurant: restaurant, p_id: request.id, p_provider_refund: prior.id,
    });
    if (recordError || !Number.isSafeInteger(recorded?.revision)) throw new Error(`Could not record the returned fee: ${recordError?.message ?? "no revision"}`);
  }
  return false;
}
