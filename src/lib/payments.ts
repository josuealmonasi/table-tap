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
  method: "card" | "cash";
  stripePaymentIntent?: string | null;
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
 */
export async function recordPayment(payment: PaymentRecord): Promise<void> {
  if (!(payment.amount > 0)) return;

  const { error } = await createAdminClient().from("payments").insert({
    restaurant_id: payment.restaurantId,
    order_id: payment.orderId ?? null,
    session_id: payment.sessionId ?? null,
    amount: round2(payment.amount),
    method: payment.method,
    stripe_payment_intent: payment.stripePaymentIntent ?? null,
    actor_email: payment.actorEmail ?? null,
  });

  if (error) {
    // Loud in the platform logs, silent to the caller, on purpose.
    console.error("payment not recorded:", payment.orderId, error.message);
  }
}

/** Several at once — settling a table pays off every order it owed. */
export async function recordPayments(payments: PaymentRecord[]): Promise<void> {
  for (const payment of payments) await recordPayment(payment);
}
