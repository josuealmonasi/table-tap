import type Stripe from "stripe";
import { legacyStockDemand } from "@/lib/legacy-stock";
import { createAdminClient } from "@/lib/supabase/admin";
import { unpackOrderIds } from "@/lib/stripe-limits";
import { abandonAccountCheckout } from "@/lib/account-checkout";

/** Repeated expiry deliveries return the coupon and reserved stock only once. */
export async function abandonCheckout(session: Stripe.Checkout.Session): Promise<void> {
  if (session.metadata?.account_checkout) return await abandonAccountCheckout(session);
  const billOrder = unpackOrderIds(session.metadata)[0];
  const orderId = billOrder ?? session.metadata?.order_id;
  if (!orderId) return;
  const db = createAdminClient();
  const { data: order, error: readError } = await db.from("orders")
    .select("restaurant_id, stock_managed, items").eq("id", orderId).maybeSingle();
  if (readError) throw new Error(`Checkout expiry lookup failed: ${readError.message}`);
  if (!order) return;
  const { error } = await db.rpc("abandon_checkout", {
    p_legacy_demand: billOrder ? [] : await legacyStockDemand(order.restaurant_id, order),
    p_order: orderId,
    // Food on an open bill has already been served; only its coupon returns.
    p_delete_order: !billOrder,
  });
  if (error) throw new Error(`Checkout expiry ${session.id} failed: ${error.message}`);
}
