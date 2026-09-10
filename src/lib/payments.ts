import { createAdminClient } from "@/lib/supabase/admin";
import { round2 } from "@/lib/money";

/**
 * Recording money that arrived.
 *
 * SERVER-ONLY: writes with the secret key, because no browser may say it paid.
 *
 * The ledger sits beside `orders.paid` rather than replacing it. Two records of
 * the same fact is the shape of every bug this app has had, so there is exactly
 * one rule about them: a route that marks an order paid records the payment in
 * the same breath, and `pnpm money` fails when the two disagree. Reads still
 * come from `orders` — moving them is its own change, with its own proof.
 */
export interface PaymentRecord {
  restaurantId: string;
  /** The order this settled, when it settled one. A divided bill will not. */
  orderId?: string | null;
  /** The sitting it belongs to, so a table's payments can be summed. */
  sessionId?: string | null;
  amount: number;
  /**
   * How much of `amount` was a gratuity.
   *
   * The tip is attributed to the ORDER, accumulating, the way settling a whole
   * table already does. This says how much of THIS payment it was, which is
   * what lets a bill settled in parts know how much of the food is still owed.
   */
  tip?: number;
  method: "card" | "cash";
  stripePaymentIntent?: string | null;
  /**
   * The caller's own reference for this collection, reused on every retry of
   * it. `payments_one_per_ref` refuses the second copy, which is what keeps a
   * double-tapped button on a waiter's phone from recording the same cash
   * twice and closing a bill that is still owed.
   */
  clientRef?: string | null;
  /** Staff who took it; null when the diner paid online. */
  actorEmail?: string | null;
}

/**
 * Write one payment.
 *
 * Never throws: money has already changed hands by the time this is called, and
 * a failed insert must not turn a completed payment into a 500 that makes the
 * diner pay twice. A miss shows up in `pnpm money` instead, where it can be
 * looked at without anyone's card being charged again.
 *
 * @returns whether a row was actually written. False for a duplicate the
 * database refused, which a caller doing anything else with the payment — a
 * tip that accumulates onto an order, say — has to know about, or the retry
 * that recorded nothing still moves the money a second time.
 */
export async function recordPayment(payment: PaymentRecord): Promise<boolean> {
  if (!(payment.amount > 0)) return false;

  const { error } = await createAdminClient().from("payments").insert({
    restaurant_id: payment.restaurantId,
    order_id: payment.orderId ?? null,
    session_id: payment.sessionId ?? null,
    amount: round2(payment.amount),
    tip: round2(payment.tip ?? 0),
    method: payment.method,
    stripe_payment_intent: payment.stripePaymentIntent ?? null,
    client_ref: payment.clientRef ?? null,
    actor_email: payment.actorEmail ?? null,
  });

  // A duplicate is not a failure. `payments_one_per_intent` refuses a second
  // row for the same order and the same Stripe payment, and `payments_one_per_ref`
  // refuses a second row for the same collection reference — which is exactly
  // what a webhook Stripe delivers twice, or a button tapped twice, would
  // otherwise insert. The money is already in the ledger, so there is nothing
  // to do and nothing to report.
  if (error && error.code !== "23505") {
    // Loud in the platform logs, silent to the caller, on purpose.
    console.error("payment not recorded:", payment.orderId, error.message);
  }
  return !error;
}

/** Several at once — settling a table pays off every order it owed. */
export async function recordPayments(payments: PaymentRecord[]): Promise<void> {
  for (const payment of payments) await recordPayment(payment);
}
