import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { unpackOrderIds } from "@/lib/stripe-limits";
import { releaseStock } from "@/lib/stock-service";
import type { OrderLineItem } from "@/lib/types";
import { abandonAccountCheckout } from "@/lib/account-checkout";

/**
 * A checkout that was opened and never paid.
 *
 * Gives back the coupon use so a limited code is not burned by an abandoned
 * cart, and clears the order that will never be paid for.
 */
export async function abandonCheckout(session: Stripe.Checkout.Session): Promise<void> {
  if (session.metadata?.account_checkout) return await abandonAccountCheckout(session);
  // A bill that was never paid: the orders are real food already eaten, so
  // only the coupon reservation goes back — the rows stay on the table.
  const settled = unpackOrderIds(session.metadata)[0];
  if (settled) {
    await releaseReservation(settled);
    return;
  }

  const orderId = session.metadata?.order_id;
  if (orderId) await releaseAbandonedOrder(orderId);
}

/** Hands back an unconfirmed coupon use held against an order. */
async function releaseReservation(orderId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data: reservation } = await supabase
    .from("coupon_redemptions")
    .select("id, coupon_id")
    .eq("order_id", orderId)
    .is("confirmed_at", null)
    .maybeSingle();

  if (reservation?.coupon_id) {
    await supabase.rpc("release_coupon", { p_coupon_id: reservation.coupon_id });
  }
  if (reservation?.id) {
    await supabase.from("coupon_redemptions").delete().eq("id", reservation.id);
  }
}

async function releaseAbandonedOrder(orderId: string): Promise<void> {
  const supabase = createAdminClient();
  await releaseReservation(orderId);

  // Read the lines before the row goes, because the stock they reserved is
  // worked out from them. Deleting first would lose the only record of what
  // this checkout was holding, and the food would stay sold to nobody.
  const { data: abandoned } = await supabase
    .from("orders")
    .select("restaurant_id, items")
    .eq("id", orderId)
    .eq("status", "pending_payment")
    .eq("paid", false)
    .maybeSingle();

  // Only ever remove an order that was never paid for.
  const { error } = await supabase
    .from("orders")
    .delete()
    .eq("id", orderId)
    .eq("status", "pending_payment")
    .eq("paid", false);

  // Only after the row is really gone: releasing first and then failing to
  // delete would hand the same stock back twice if this ran again.
  if (!error && abandoned) {
    await releaseStock(
      abandoned.restaurant_id as string,
      (abandoned.items ?? []) as OrderLineItem[],
    );
  }
}
