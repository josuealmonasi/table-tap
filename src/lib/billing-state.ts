import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { BillingError } from "@/lib/billing-operation";
import type { createAdminClient } from "@/lib/supabase/admin";

export const finishedSubscription = (status: string): boolean =>
  status === "canceled" || status === "incomplete_expired";
export interface BillingSnapshot {
  customers: string[];
  sessions: string[];
  subscriptions: string[];
}

export async function billingPages<T extends { id: string }>(
  read: (after?: string) => Promise<{ data: T[]; has_more: boolean }>,
): Promise<T[]> {
  const result: T[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await read(after);
    result.push(...page.data);
    if (!page.has_more) return result;
    after = page.data.at(-1)?.id;
    if (!after) throw new Error("Billing page has no continuation");
  }
}

// Read only after taking the billing lock. A second request must see the
// customer the first saved, and a completed checkout before its webhook.
// Recovery also reads customers directly: a crash may have lost their local ID.
export async function restaurantBilling(db: ReturnType<typeof createAdminClient>, id: string, discover = false) {
  const { data: restaurant, error } = await db.from("restaurants")
    .select("name, stripe_customer_id, stripe_subscription_id").eq("id", id).maybeSingle();
  if (error) throw new Error(`Billing lookup failed: ${error.message}`);
  const { data: record, error: recordError } = await db.from("restaurant_billing_operations")
    .select("state").eq("restaurant_id", id).maybeSingle();
  if (recordError) throw new Error(`Billing record lookup failed: ${recordError.message}`);
  const saved = record?.state as (Partial<BillingSnapshot> & { deletion_requested?: boolean }) | undefined;
  if (!restaurant && !saved?.deletion_requested) throw new BillingError("apiErr.restaurantNotFound", 404);
  const owner = restaurant ?? { name: "", stripe_customer_id: null, stripe_subscription_id: null };
  const customers = new Set<string>(saved?.customers ?? []);
  if (owner.stripe_customer_id) customers.add(owner.stripe_customer_id);
  if (discover) {
    // Search indexes are eventually consistent. Listing avoids missing a
    // customer created just before a worker lost its response.
    const found = await billingPages(after => stripe.customers.list({ limit: 100, ...(after ? { starting_after: after } : {}) }));
    for (const customer of found) if (customer.metadata?.restaurant_id === id) customers.add(customer.id);
  }
  const sessions: Stripe.Checkout.Session[] = [];
  const subscriptions: Stripe.Subscription[] = [];
  for (const customer of customers) {
    // Read open checkouts first: one completing between these reads must be
    // seen either here or in the later subscription read before deletion.
    sessions.push(...await billingPages(after => stripe.checkout.sessions.list({
      customer, status: "open", limit: 100, ...(after ? { starting_after: after } : {}),
    })));
    subscriptions.push(...await billingPages(after => stripe.subscriptions.list({
      customer, status: "all", limit: 100, ...(after ? { starting_after: after } : {}),
    })));
  }
  const linked = owner.stripe_subscription_id as string | null;
  for (const subscription of new Set([...(saved?.subscriptions ?? []), ...(linked ? [linked] : [])])) {
    if (!subscriptions.some(s => s.id === subscription)) {
      // A missing or unreadable linked contract is not proof that billing ended.
      subscriptions.push(await stripe.subscriptions.retrieve(subscription));
    }
  }
  const live = [...new Map(subscriptions.filter(s => !finishedSubscription(s.status)).map(s => [s.id, s])).values()];
  const open = [...new Map(sessions.filter(s => s.mode === "subscription").map(s => [s.id, s])).values()];
  const snapshot: BillingSnapshot = { customers: [...customers], sessions: open.map(s => s.id), subscriptions: live.map(s => s.id) };
  return { restaurant: owner, exists: !!restaurant, live, sessions: open, snapshot };
}
