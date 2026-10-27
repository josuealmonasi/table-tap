import { after } from "next/server";
import { syncReturnedFee } from "./fee";
import { recoverQueuedFees } from "./fee-queue";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";

export interface RefundOperation {
  id: string;
  adjustment_id: string;
  source: "stripe" | "cash" | "terminal" | "review";
  amount: number;
  tip: number;
  currency: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "review";
  original_collector: string | null;
  created_at: string;
}

export async function orderRefunds(restaurantId: string, adjustmentId?: string): Promise<RefundOperation[]> {
  // Fee recovery runs after the response so an unavailable provider cannot
  // hold up opening Bills or collecting the next customer's payment.
  if (!adjustmentId) after(() => recoverOrderRefundFees(restaurantId, "fee recovery")
    .catch(error => console.error("Order refund fee recovery remains pending", error)));
  const db = createAdminClient();
  return await everyRow<RefundOperation>((from, to) => {
    let q = db.from("refund_operations")
      .select("id, adjustment_id, source, amount, tip, currency, status, original_collector, created_at")
      .eq("restaurant_id", restaurantId);
    if (adjustmentId) q = q.eq("adjustment_id", adjustmentId);
    else q = q.neq("status", "succeeded");
    return q.order("id").range(from, to);
  }, "the order refunds");
}

/** Persist provider state before showing completion. A lost response reuses
 * the durable attempt's exact request, account and idempotency key. */
export async function executeOrderRefund(
  restaurantId: string, operationId: string, actor: string, client: Stripe = stripe,
): Promise<boolean> {
  const db = createAdminClient();
  const { data: attempt, error } = await db.rpc("start_refund_attempt", {
    p_restaurant: restaurantId, p_operation: operationId,
  });
  if (error) throw new Error(`Could not prepare the refund: ${error.message}`);
  if (!attempt) return false;
  if (attempt.operation_status === "succeeded") {
    await reconcileFee();
    return true;
  }
  async function reconcileFee() {
    try {
      await syncReturnedFee(client, restaurantId, attempt.stripe_payment_intent, attempt.stripe_account_id);
    } catch (error) {
      // A fee lookup cannot undo money already returned to the diner. The
      // ledger keeps consuming the fee until a later verified reconciliation.
      console.error("Order refund fee reconciliation remains pending", operationId, error);
    }
  }
  const options = { stripeAccount: attempt.stripe_account_id as string };
  let refund: Stripe.Refund;
  try {
    if (attempt.stripe_refund_id) {
      refund = await client.refunds.retrieve(attempt.stripe_refund_id, options);
    } else {
      // Provider idempotency expires. A durable metadata search recovers an
      // older successful attempt before its key can ever create another one.
      let prior: Stripe.Refund | undefined;
      for await (const made of client.refunds.list({ payment_intent: attempt.stripe_payment_intent, limit: 100 }, options)) {
        if (made.metadata?.refund_attempt === attempt.id || (attempt.attempt_no === 1 && made.metadata?.refund_operation === operationId && !made.metadata?.refund_attempt)) { prior = made; break; }
      }
      refund = prior ?? await client.refunds.create({
        payment_intent: attempt.stripe_payment_intent,
        amount: Math.round(Number(attempt.amount) * 100),
        refund_application_fee: true,
        metadata: { refund_operation: operationId, refund_attempt: attempt.id },
      }, { ...options, idempotencyKey: attempt.idempotency_key });
    }
  } catch (error) {
    // Unknown means outstanding, never completed and never a new attempt.
    console.error("Order refund remains pending", operationId, error);
    return false;
  }
  const { data: completed, error: writeError } = await db.rpc("finish_refund_operation", {
    p_restaurant: restaurantId, p_operation: operationId, p_actor: actor,
    p_refund: refund.id, p_attempt: attempt.id, p_status: refund.status ?? "pending",
  });
  if (writeError) throw new Error(`Could not record the refund outcome: ${writeError.message}`);
  if (completed && refund.status === "succeeded") await reconcileFee();
  return Boolean(completed && refund.status === "succeeded");
}

/** Recovery is separate from customer completion, including after a restart. */
export async function recoverOrderRefundFees(restaurantId: string, actor: string): Promise<void> {
  const db = createAdminClient();
  const pending = await everyRow<{ id: string }>((a, b) => db.from("refund_operations").select("id")
    .eq("restaurant_id", restaurantId).eq("source", "stripe").eq("status", "succeeded")
    .is("fee_reconciled_at", null).order("id").range(a, b), "the returned fees awaiting verification");
  await recoverQueuedFees(db, stripe, restaurantId);
  for (const operation of pending) await executeOrderRefund(restaurantId, operation.id, actor);
}
