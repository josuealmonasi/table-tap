import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
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
/** All the fee and currency checks need: where the charge lives. */
export type DueCharge = Pick<DueAttempt, "stripe_account_id" | "stripe_payment_intent">;

export async function verifyDueCurrency(db: Db, restaurant: string, id: string, attempt: DueCharge, client: Stripe): Promise<string | null> {
  const intent = await client.paymentIntents.retrieve(attempt.stripe_payment_intent, {}, { stripeAccount: attempt.stripe_account_id });
  const currency = intent.currency?.toUpperCase();
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return null;
  const { error } = await db.from("refunds_due").update({ currency, stripe_account_id: attempt.stripe_account_id })
    .eq("restaurant_id", restaurant).eq("id", id).is("currency", null);
  if (error) throw new Error(`Could not save the original refund currency: ${error.message}`);
  return currency;
}

/** Customer completion is durable even if returning or checking our fee fails. */
export async function reconcileDueFee(db: Db, restaurant: string, id: string, attempt: DueCharge, client: Stripe): Promise<boolean> {
  try {
    const { error: pendingError } = await db.from("refunds_due").update({ fee_verification_pending: true })
      .eq("restaurant_id", restaurant).eq("id", id).not("refunded_at", "is", null);
    if (pendingError) throw new Error(`Could not preserve pending fee verification: ${pendingError.message}`);
    await syncReturnedFee(client, restaurant, attempt.stripe_payment_intent, attempt.stripe_account_id, db);
    // A manual refund can raise the target during fee recovery.
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
