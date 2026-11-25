import { createAdminClient } from "@/lib/supabase/admin";

interface SettledCheckout {
  restaurant_id: string;
  stripe_account_id: string;
  livemode: boolean;
}

/**
 * Stripe delivers events in any order (Codex bl43 findings 4 and 5). A refund
 * or a dispute that arrived before the checkout owning its PaymentIntent
 * settled found no sale: the refund's fee return was never queued, and the
 * dispute was set aside for review and left out of the restaurant's books.
 * Once verified settlement has bound the intent to this checkout, the
 * database queues that fee reconciliation and sends those dispute events back
 * to the worker. Failing throws, so the webhook is retried.
 */
export async function adoptSettledIntent(checkout: SettledCheckout, intent: string): Promise<void> {
  const { error } = await createAdminClient().rpc("adopt_settled_intent_v1", {
    p_restaurant: checkout.restaurant_id, p_account: checkout.stripe_account_id, p_live: checkout.livemode, p_intent: intent,
  });
  if (error) throw new Error(`Could not adopt the settled payment's early events: ${error.message}`);
}
