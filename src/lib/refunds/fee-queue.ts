import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { reconcileChargeFee } from "./charge-reconciler";

type Db = ReturnType<typeof createAdminClient>;

/**
 * Records that freeze the account a TableTap charge was made on. The webhook
 * enqueues only charges one of them knows, the recovery reads the account from
 * them, and `admin_delete_restaurant` waits only on queue rows they explain:
 * the three must agree (review bg4). Account checkouts are paid through a
 * `diner_checkouts` session and write a `payments` row, so they are covered.
 */
export const FEE_ACCOUNT_SOURCES = ["fee_returns", "diner_checkouts", "refund_operations", "refunds_due", "payments"] as const;

async function chargeAccount(db: Db, restaurant: string, intent: string): Promise<string | undefined> {
  // These records freeze the account that owned this charge. Reconnecting
  // the restaurant must never relabel an older charge with its new account.
  for (const table of FEE_ACCOUNT_SOURCES) {
    const { data, error } = await db.from(table).select("stripe_account_id")
      .eq("restaurant_id", restaurant).eq("stripe_payment_intent", intent).not("stripe_account_id", "is", null)
      .order("id").limit(1).maybeSingle();
    if (error) throw new Error(`Could not read the original fee account: ${error.message}`);
    if (data?.stripe_account_id) return data.stripe_account_id;
  }
  return undefined;
}

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
  // A charge the restaurant made outside TableTap carries no fee of ours, and
  // a queue row nothing can resolve used to stay forever (review bg4).
  if (!(await chargeAccount(db, restaurant.id, intent))) return;
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
  const account = await chargeAccount(db, restaurant, intent);
  if (account) return reconcileChargeFee(db, client, restaurant, intent, account);
  return closeForeignCharge(db, restaurant, intent);
}

/**
 * No record says TableTap made this charge, so there is no fee of ours to
 * return. The row is closed as not ours instead of being polled forever and
 * holding the restaurant's deletion. Only the generation read is removed: a
 * newer enqueue survives.
 */
async function closeForeignCharge(db: Db, restaurant: string, intent: string): Promise<boolean> {
  const { data: row, error } = await db.from("fee_reconcile_queue").select("generation")
    .eq("restaurant_id", restaurant).eq("stripe_payment_intent", intent).maybeSingle();
  if (error) throw new Error(`Could not read the queued fee: ${error.message}`);
  if (!row) return true;
  const { error: ackError } = await db.rpc("ack_fee_reconcile",
    { p_restaurant: restaurant, p_intent: intent, p_generation: row.generation });
  if (ackError) throw new Error(`Could not close a charge that is not ours: ${ackError.message}`);
  console.warn("Closed a queued fee with no TableTap charge behind it (not ours)", restaurant, intent);
  return true;
}
