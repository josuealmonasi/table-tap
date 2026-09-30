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

/** Lifts an open checkout's hold on its account; a paid one is left alone. */
export async function releaseAccountCheckout(checkoutId: string): Promise<void> {
  const db = createAdminClient();
  const { data } = await db.from("account_checkouts").update({ status: "expired" })
    .eq("id", checkoutId).eq("status", "open").select("account_id");
  const accountId = data?.[0]?.account_id as string | undefined;
  if (accountId) await db.from("customer_accounts").update({ checkout_until: null }).eq("id", accountId);
}
