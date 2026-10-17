import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { applySubscription } from "@/lib/subscription-sync";
import { BillingError, withRestaurantBilling } from "@/lib/billing-operation";
import { restaurantBilling } from "@/lib/billing-state";
import { BILLING_CURRENCY, checkoutPrice } from "@/lib/billing-price";
import type { PlanLimits } from "@/lib/plan";
import type { createAdminClient } from "@/lib/supabase/admin";

export async function startRestaurantBilling(
  db: ReturnType<typeof createAdminClient>,
  owner: { restaurantId: string; email: string },
  limits: PlanLimits, taken: number, origin: string,
): Promise<{ url: string }> {
  return await withRestaurantBilling(db, owner.restaurantId, async operation => {
    const { restaurant, live, sessions, snapshot, exists } = await restaurantBilling(db, owner.restaurantId);
    if (!exists) throw new BillingError("apiErr.restaurantNotFound", 404);
    await operation.record(snapshot);
    if (!restaurant.stripe_customer_id && snapshot.customers.length === 1) {
      const recovered = snapshot.customers[0];
      const { error } = await operation.write(async () => await db.from("restaurants")
        .update({ stripe_customer_id: recovered }).eq("id", owner.restaurantId));
      if (error) throw new Error(`Billing customer recovery failed: ${error.message}`);
      restaurant.stripe_customer_id = recovered;
    }
    if (live.length > 1) throw new BillingError("apiErr.billingConflict");
    const subscription = live[0];
    if (subscription) {
      if (subscription.metadata.restaurant_id !== owner.restaurantId || subscription.items.data.length !== 1) {
        throw new BillingError("apiErr.billingConflict");
      }
      if (subscription.items.data[0].price.currency !== BILLING_CURRENCY) throw new BillingError("apiErr.billingConflict");
      // First-payment failures and overdue invoices need settling before a
      // tier change. Prorating unpaid time can otherwise give unearned credit.
      if (!["active", "trialing"].includes(subscription.status)) {
        const invoiceId = typeof subscription.latest_invoice === "string" ? subscription.latest_invoice : subscription.latest_invoice?.id;
        if (invoiceId) {
          const invoice = await stripe.invoices.retrieve(invoiceId);
          if (invoice.hosted_invoice_url) return { url: invoice.hosted_invoice_url };
        }
        const portal = await operation.write(() => stripe.billingPortal.sessions.create({
          customer: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
          return_url: `${origin}/dashboard`,
        }));
        return { url: portal.url };
      }
      // Old open sessions could create another contract even after this update.
      for (const session of sessions) await operation.write(() => stripe.checkout.sessions.expire(session.id));
      if (subscription.metadata.plan !== limits.plan) {
        const line = await checkoutPrice(limits, taken);
        let item: Stripe.SubscriptionUpdateParams.Item = { id: subscription.items.data[0].id, quantity: 1 };
        if (line.price) item.price = line.price;
        else if (line.price_data) {
          const priceData = line.price_data;
          const product = await operation.write(() => stripe.products.create(
            { name: priceData.product_data?.name ?? "TableTap" },
            { timeout: 30000, maxNetworkRetries: 1, idempotencyKey: `billing-product-${operation.token}` },
          ));
          item = { ...item, price_data: {
            currency: priceData.currency, product: product.id,
            unit_amount: priceData.unit_amount,
            recurring: { interval: "month" },
          } };
        }
        await operation.write(() => stripe.subscriptions.update(subscription.id, {
          items: [item], metadata: { restaurant_id: owner.restaurantId, plan: limits.plan },
          // A declined upgrade leaves both the old price and tier intact.
          payment_behavior: "error_if_incomplete", proration_behavior: "always_invoice",
        }, { timeout: 30000, maxNetworkRetries: 1, idempotencyKey: `billing-change-${operation.token}` }));
      }
      await applySubscription(subscription);
      return { url: `${origin}/dashboard?subscribed=1` };
    }
    if (sessions.length) {
      if (sessions.length === 1 && sessions[0].metadata?.plan === limits.plan && sessions[0].url) return { url: sessions[0].url };
      // Choosing a different tier closes the earlier link before opening one.
      for (const session of sessions) await operation.write(() => stripe.checkout.sessions.expire(session.id));
    }
    const line = await checkoutPrice(limits, taken);
    // One customer per restaurant, reused for every later change of plan, so
    // Stripe keeps one billing history rather than one per subscription.
    let customer = (restaurant.stripe_customer_id as string | null) ?? snapshot.customers[0];
    if (!customer) {
      const created = await operation.write(() => stripe.customers.create({
        email: owner.email, name: restaurant.name, metadata: { restaurant_id: owner.restaurantId },
      }, { timeout: 30000, maxNetworkRetries: 1, idempotencyKey: `billing-customer-${owner.restaurantId}` }));
      customer = created.id;
      await operation.record({ customers: [customer] });
    }
    if (customer !== restaurant.stripe_customer_id) {
      const { error } = await operation.write(async () => await db.from("restaurants")
        .update({ stripe_customer_id: customer }).eq("id", owner.restaurantId));
      if (error) throw new Error(`Billing customer save failed: ${error.message}`);
    }
    // The only trusted signal about who bought what: the webhook reads these
    // back rather than believing anything the browser returns with.
    const metadata = { restaurant_id: owner.restaurantId, plan: limits.plan };
    const session = await operation.write(() => stripe.checkout.sessions.create({
      mode: "subscription", customer, line_items: [line],
      client_reference_id: owner.restaurantId, subscription_data: { metadata }, metadata,
      // The dashboard, until there is a plan screen to land on. Somebody who
      // has just paid must never arrive at a 404.
      success_url: `${origin}/dashboard?subscribed=1`, cancel_url: `${origin}/dashboard`,
    }, { timeout: 30000, maxNetworkRetries: 1, idempotencyKey: `billing-checkout-${operation.token}` }));
    await operation.record({ sessions: [session.id] });
    if (!session.url) throw new Error("Billing checkout has no URL");
    return { url: session.url };
  });
}
