import { stripe } from "@/lib/stripe";
import { restaurantBilling, finishedSubscription } from "@/lib/billing-state";
import type { BillingOperation } from "@/lib/billing-operation";
import type { createAdminClient } from "@/lib/supabase/admin";

// There is deliberately no cascading FK on this record: losing the restaurant
// must never erase the Stripe IDs needed to retry a failed deletion.
export async function endRestaurantBilling(
  db: ReturnType<typeof createAdminClient>, id: string, operation: BillingOperation,
): Promise<void> {
  const initial = await restaurantBilling(db, id, true);
  await operation.record({ ...initial.snapshot, deletion_requested: true });
  // An open link could finish while cancellation is running. Expire it first,
  // then read subscriptions again to catch a just-completed checkout.
  for (const session of initial.sessions) {
    await operation.write(() => stripe.checkout.sessions.expire(session.id, {}, { timeout: 30000, maxNetworkRetries: 1 }));
  }
  const current = await restaurantBilling(db, id);
  await operation.record(current.snapshot);
  for (const sub of current.live) {
    const canceled = await operation.write(() => stripe.subscriptions.cancel(sub.id, {}, {
      timeout: 30000, maxNetworkRetries: 1, idempotencyKey: `billing-delete-${operation.token}-${sub.id}`,
    }));
    if (!finishedSubscription(canceled.status)) throw new Error(`Billing cancellation unconfirmed: ${sub.id}`);
  }
  // A successful HTTP response alone is not proof that billing ended.
  const confirmed = await restaurantBilling(db, id);
  if (confirmed.live.length || confirmed.sessions.length) throw new Error("Billing deletion requires retry");
}
