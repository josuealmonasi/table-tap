import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { returnOurFee } from "./due-provider";
import { syncReturnedFee } from "./fee";

type Db = ReturnType<typeof createAdminClient>;
export interface DueAttempt {
  id: string;
  attempt_no: number;
  idempotency_key: string;
  amount: number;
  stripe_account_id: string;
  stripe_payment_intent: string;
  stripe_refund_id: string | null;
}

/** Original provider evidence can fill a missing currency, never relabel one. */
export async function verifyDueCurrency(db: Db, restaurant: string, id: string, attempt: DueAttempt, client: Stripe): Promise<string | null> {
  const intent = await client.paymentIntents.retrieve(attempt.stripe_payment_intent, {}, { stripeAccount: attempt.stripe_account_id });
  const currency = intent.currency?.toUpperCase();
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return null;
  const { error } = await db.from("refunds_due").update({ currency, stripe_account_id: attempt.stripe_account_id })
    .eq("restaurant_id", restaurant).eq("id", id).is("currency", null);
  if (error) throw new Error(`Could not save the original refund currency: ${error.message}`);
  return currency;
}

/** Customer completion is durable even if returning or checking our fee fails. */
export async function reconcileDueFee(db: Db, restaurant: string, id: string, attempt: DueAttempt, client: Stripe): Promise<boolean> {
  try {
    const { error: pendingError } = await db.from("refunds_due").update({ fee_verification_pending: true })
      .eq("restaurant_id", restaurant).eq("id", id).not("refunded_at", "is", null);
    if (pendingError) throw new Error(`Could not preserve pending fee verification: ${pendingError.message}`);
    // Before any provider read, like syncReturnedFee.
    const { data: epoch, error: epochError } = await db.rpc("refund_fee_epoch", { p_restaurant: restaurant, p_intent: attempt.stripe_payment_intent });
    if (epochError || typeof epoch !== "number") throw new Error(`Could not read the fee verification epoch: ${epochError?.message ?? "no epoch"}`);
    const returned = await returnOurFee(client, attempt.stripe_payment_intent, attempt.stripe_account_id,
      Math.round(Number(attempt.amount) * 100), id, async (feeId, amount, previous, outcome) => {
        // Both under the epoch read before Stripe: a refund failing since makes
        // the amount stale, and it must not be requested (audit R finding 2).
        const { data, error } = previous && outcome ? await db.rpc("advance_refund_due_fee_v2", {
          p_restaurant: restaurant, p_due: id, p_previous: previous, p_target: outcome.target,
          p_returned: outcome.returned, p_fee_total: outcome.total, p_refund: outcome.refund ?? null, p_epoch: epoch,
        }) : await db.rpc("start_refund_due_fee_v2", { p_restaurant: restaurant, p_due: id, p_fee: feeId, p_amount: amount, p_epoch: epoch });
        if (error || !data) throw new Error("Could not save the fee return request");
        return data;
      }, async target => {
        // Only ever raised, and only by a read made under the current epoch:
        // a refund failing since would make this target stale (audit Q 4).
        const { data: saved, error } = await db.rpc("save_refund_due_fee_target", {
          p_restaurant: restaurant, p_due: id, p_target: Math.trunc(target), p_epoch: epoch,
        });
        if (error) throw new Error(`Could not save the verified fee target: ${error.message}`);
        if (saved !== true) throw new Error("The returned fee changed while it was being verified");
      });
    if (!returned) return false;
    await syncReturnedFee(client, restaurant, attempt.stripe_payment_intent, attempt.stripe_account_id);
    // A manual refund can raise the target after returnOurFee's snapshot.
    // Only the final verification under the money lock can finish this row.
    const { data, error } = await db.from("refunds_due").select("fee_reconciled_at, fee_verification_pending")
      .eq("restaurant_id", restaurant).eq("id", id).maybeSingle();
    if (error) throw new Error(`Could not read the verified fee outcome: ${error.message}`);
    return Boolean(data?.fee_reconciled_at && data.fee_verification_pending === false);
  } catch (error) {
    console.error("refund due: could not reconcile the returned fee", error);
    return false;
  }
}
