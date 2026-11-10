import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { reconcileChargeFee } from "./charge-reconciler";

type Db = ReturnType<typeof createAdminClient>;

/** A successful provider refund must be durable before Stripe hears 200. */
export async function enqueueRefundFee(object: Stripe.Refund | Stripe.Charge, account: string | undefined): Promise<void> {
  if (!account) return;
  const intent = typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id;
  if (!intent) return;
  const db = createAdminClient();
  const { data: restaurant, error } = await db.from("restaurants").select("id")
    .eq("stripe_account_id", account).maybeSingle();
  if (error) throw new Error(`Could not find the restaurant for a returned fee: ${error.message}`);
  if (!restaurant) return;
  const { data, error: enqueueError } = await db.rpc("enqueue_fee_reconcile", { p_restaurant: restaurant.id, p_intent: intent });
  if (enqueueError || !Number.isSafeInteger(data)) throw new Error(`Could not enqueue the returned fee: ${enqueueError?.message ?? "no generation"}`);
}

/** Includes manual Stripe returns after every local operation was reconciled. */
export async function recoverQueuedFees(db: Db, client: Stripe, restaurant: string): Promise<void> {
  const pending = await everyRow<{ stripe_payment_intent: string; generation: number }>((a, b) => db.from("fee_reconcile_queue")
    .select("stripe_payment_intent, generation").eq("restaurant_id", restaurant)
    .order("stripe_payment_intent").range(a, b), "the charge fees awaiting reconciliation");
  for (const row of pending) {
    try {
      await recoverQueuedFee(db, client, restaurant, row.stripe_payment_intent);
    } catch (error) {
      // One unavailable charge must not starve the rest of the restaurant.
      console.error("Charge fee recovery remains pending", row.stripe_payment_intent, error);
    }
  }
}

export async function recoverQueuedFee(db: Db, client: Stripe, restaurant: string, intent: string): Promise<boolean> {
  // These records freeze the account that owned this charge. Reconnecting
  // the restaurant must never relabel an older charge with its new account.
  let account: string | undefined;
  for (const table of ["fee_returns", "diner_checkouts", "refund_operations", "refunds_due"]) {
    const { data, error } = await db.from(table).select("stripe_account_id")
      .eq("restaurant_id", restaurant).eq("stripe_payment_intent", intent)
      .order("id").limit(1).maybeSingle();
    if (error) throw new Error(`Could not read the original fee account: ${error.message}`);
    if (data?.stripe_account_id) { account = data.stripe_account_id; break; }
  }
  // With no original account evidence, keep the queue row for review.
  return account ? reconcileChargeFee(db, client, restaurant, intent, account) : false;
}
