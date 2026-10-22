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
    const returned = await returnOurFee(client, attempt.stripe_payment_intent, attempt.stripe_account_id,
      Math.round(Number(attempt.amount) * 100), id, async (feeId, amount) => {
        const { data, error } = await db.rpc("start_refund_due_fee", {
          p_restaurant: restaurant, p_due: id, p_fee: feeId, p_amount: amount,
        });
        if (error || !data) throw new Error("Could not save the fee return request");
        return data;
      });
    if (!returned) return false;
    await syncReturnedFee(client, restaurant, attempt.stripe_payment_intent, attempt.stripe_account_id);
    const { error } = await db.from("refunds_due").update({ fee_reconciled_at: new Date().toISOString() })
      .eq("restaurant_id", restaurant).eq("id", id).not("refunded_at", "is", null);
    if (error) throw new Error(`Could not record the returned fee: ${error.message}`);
    return true;
  } catch (error) {
    console.error("refund due: could not reconcile the returned fee", error);
    return false;
  }
}
