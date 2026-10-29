import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A divided bill refuses with "paying" while a whole-bill card page is open on
 * its orders: Stripe may have charged it with the webhook still on its way.
 * Ask Stripe about each such page; one Stripe says expired is closed exactly as
 * its expiry webhook would. Answers whether any page was closed, so the caller
 * retries once. Open or paid pages, and any read failure, leave the refusal.
 */
export async function closeExpiredWholeBillPages(restaurantId: string, args: Record<string, unknown>): Promise<boolean> {
  const db = createAdminClient();
  let orderIds: string[] = [];
  if (typeof args.p_split === "string") {
    const { data } = await db.from("bill_splits").select("order_ids").eq("id", args.p_split).eq("restaurant_id", restaurantId).maybeSingle();
    orderIds = data?.order_ids ?? [];
  } else if (typeof args.p_session === "string") {
    const { data } = await db.from("orders").select("id").eq("session_id", args.p_session).eq("restaurant_id", restaurantId);
    orderIds = (data ?? []).map(o => o.id);
  }
  if (!orderIds.length) return false;
  const { data: pages, error } = await db.from("diner_checkouts")
    .select("id, stripe_session_id, stripe_account_id, split_id, metadata, scope_key, created_at")
    .eq("restaurant_id", restaurantId).eq("status", "open").is("split_id", null).overlaps("order_ids", orderIds);
  if (error || !pages) return false;
  let closed = false;
  // Loaded only when a page must be read: every split route imports this module.
  const { stripe } = await import("@/lib/stripe");
  for (const page of pages) {
    if (page.metadata?.split_model === "2" || !page.stripe_account_id) continue;
    if (!page.stripe_session_id) {
      // Saved, but its Stripe page was never bound (the process stopped
      // between the two). Resending its saved request returns that same page
      // while Stripe still keeps the key (24h), binds it, and closes it if it
      // expired. Older than that, nothing here can prove it never charged.
      const age = Date.now() - new Date(page.created_at).getTime();
      if (!page.scope_key || age > 23 * 3600 * 1000) continue;
      try {
        const { resumeDinerAttempt } = await import("@/lib/diner-attempt");
        await resumeDinerAttempt(stripe, restaurantId, page.scope_key);
        const { data: now } = await db.from("diner_checkouts").select("status").eq("id", page.id).maybeSingle();
        if (now?.status === "expired") closed = true;
      } catch (err) {
        console.error("split: could not resolve an unbound whole-bill card page", err);
      }
      continue;
    }
    try {
      const session = await stripe.checkout.sessions.retrieve(page.stripe_session_id, {}, { stripeAccount: page.stripe_account_id });
      if (session.status !== "expired") continue;
      const { error: finishError } = await db.rpc("finish_diner_checkout", { p_attempt: page.id, p_paid: false });
      if (!finishError) closed = true;
    } catch (err) {
      // Stripe unreachable is not proof the page cannot charge.
      console.error("split: could not read a whole-bill card page", err);
    }
  }
  return closed;
}
