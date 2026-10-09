import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A customer account paid online, as Stripe's webhook reports it.
 *
 * The checkout row names exactly the orders owed when the customer started,
 * and `account_checkout_settle()` pays those, records the money and lifts the
 * hold — once: a repeated event finds it paid and changes nothing. A failure
 * throws, so the webhook answers Stripe with an error and Stripe asks again;
 * a payment read as settled when it was not would leave the customer's money
 * recorded nowhere.
 */
export async function settleAccountCheckout(session: Stripe.Checkout.Session): Promise<void> {
  const checkout = session.metadata?.account_checkout;
  if (!checkout) return;
  const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  const { error } = await createAdminClient().rpc("account_checkout_settle", {
    p_checkout: checkout,
    p_intent: intent,
  });
  if (error) throw new Error(`Could not settle the account payment: ${error.message}`);
}

/**
 * The customer walked away from Stripe: the hold comes off, so the till can
 * collect the account again without waiting out the half hour.
 */
export async function abandonAccountCheckout(session: Stripe.Checkout.Session): Promise<void> {
  const checkout = session.metadata?.account_checkout;
  if (!checkout) return;
  await releaseAccountCheckout(checkout);
}

/**
 * Lifts an open checkout's hold on its account. A paid one is left alone, and
 * so is one closed when a newer checkout opened: Stripe retries an expiry for
 * days, and one arriving late used to lift the newer checkout's hold while its
 * customer was paying. A failure throws, so Stripe sends the event again.
 */
export async function releaseAccountCheckout(checkoutId: string): Promise<void> {
  const { error } = await createAdminClient().rpc("account_checkout_release", { p_checkout: checkoutId });
  if (error) throw new Error(`Could not release the account checkout: ${error.message}`);
}
