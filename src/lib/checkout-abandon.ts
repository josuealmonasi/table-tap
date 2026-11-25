import { abandonSplitSlots } from "@/lib/split-slots-lifecycle";
import { finishDinerCheckout } from "@/lib/diner-attempt";
import type Stripe from "stripe";
import { legacyStockDemand } from "@/lib/legacy-stock";
import { createAdminClient } from "@/lib/supabase/admin";
import { unpackOrderIds } from "@/lib/stripe-limits";
import { abandonAccountCheckout } from "@/lib/account-checkout";
import { verifyDinerCheckout, type ConnectContext } from "@/lib/diner-checkout";
import { releaseSessionFee } from "@/lib/platform-fee";
import { closeSessionIfClear } from "@/lib/table-session";

/** Repeated expiry deliveries return the coupon and reserved stock only once. */
export async function abandonCheckout(session: Stripe.Checkout.Session, context: ConnectContext): Promise<void> {
  await verifyDinerCheckout(session, context);
  if (session.payment_status === "paid") throw new Error("A paid checkout cannot expire");
  // The split returns its parts, coupon and fee together, including on retry.
  if (session.metadata?.split_model === "2") return await abandonSplitSlots(session);
  // Nobody paid: the fee it reserved stops counting toward the month.
  await releaseSessionFee(session);
  await finishDinerCheckout(session, false);
  if (session.metadata?.account_checkout) return await abandonAccountCheckout(session);
  const billOrder = unpackOrderIds(session.metadata)[0];
  // Served food belongs to the bill. Only its attempt-owned coupon returns;
  // an old expiry must never touch another reservation on the same order.
  if (billOrder) return;
  const orderId = session.metadata?.order_id;
  if (!orderId) return;
  const db = createAdminClient();
  const { data: order, error: readError } = await db.from("orders")
    .select("restaurant_id, session_id, stock_managed, items").eq("id", orderId).maybeSingle();
  if (readError) throw new Error(`Checkout expiry lookup failed: ${readError.message}`);
  if (!order) return;
  const { error } = await db.rpc("abandon_checkout", {
    p_legacy_demand: await legacyStockDemand(order.restaurant_id, order),
    p_order: orderId,
    // A pay-now cart never reached the kitchen; its pending order returns too.
    p_delete_order: true,
  });
  if (error) throw new Error(`Checkout expiry ${session.id} failed: ${error.message}`);
  await recloseSettledSitting(order.session_id);
}

/**
 * The rest of the table may have paid while this page was open; the pending
 * order refused that close. Now it is gone, close the sitting again, but only
 * if the table actually settled. Diners still browsing with nothing paid keep it.
 */
async function recloseSettledSitting(sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) return;
  const { data: paid, error } = await createAdminClient().from("orders")
    .select("id").eq("session_id", sessionId).eq("paid", true).limit(1);
  if (error) throw new Error(`Checkout expiry sitting lookup failed: ${error.message}`);
  if (paid?.length) await closeSessionIfClear(sessionId, "paid");
}
