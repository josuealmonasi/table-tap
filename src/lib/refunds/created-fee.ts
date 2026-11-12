import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { enqueueRefundFee } from "./fee-queue";

/** Application fees belong to the platform, but their charges belong to the
 * original connected account. Only enqueue here; recovery verifies refunds. */
export async function enqueueCreatedFee(fee: Stripe.ApplicationFee): Promise<void> {
  const account = typeof fee.account === "string" ? fee.account : fee.account.id;
  const charge = typeof fee.charge === "string"
    ? await stripe.charges.retrieve(fee.charge, { stripeAccount: account }) : fee.charge;
  // Every card payment creates a fee; only one already refunded can owe some
  // back. Enqueueing them all cost Stripe calls per sale and held a queued fee
  // against deleting the restaurant until recovery ran.
  if (!charge.amount_refunded) return;
  await enqueueRefundFee(charge, account);
}
