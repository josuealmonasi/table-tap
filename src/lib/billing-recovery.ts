import { BillingError } from "@/lib/billing-operation";
import { restaurantBilling } from "@/lib/billing-state";
import type { createAdminClient } from "@/lib/supabase/admin";

export async function recoverBillingClaim(db: ReturnType<typeof createAdminClient>, id: string, token: string): Promise<void> {
  const { data: previous, error } = await db.from("restaurant_billing_operations")
    .select("token, started_at").eq("restaurant_id", id).maybeSingle();
  if (error) throw new Error(`Billing claim lookup failed: ${error.message}`);
  if (!previous?.token || !previous.started_at || Date.parse(previous.started_at) > Date.now() - 15 * 60000) {
    throw new BillingError("apiErr.billingBusy");
  }
  const { snapshot } = await restaurantBilling(db, id, true);
  // The compare-and-swap stores everything Stripe found before the new worker
  // may write. Two recovering servers cannot both take the expired claim.
  const { data: claimed, error: claimError } = await db.rpc("takeover_restaurant_billing", {
    p_restaurant: id, p_token: token, p_previous: previous.token, p_started_at: previous.started_at, p_state: snapshot,
  });
  if (claimError) throw new Error(`Billing takeover failed: ${claimError.message}`);
  if (!claimed) throw new BillingError("apiErr.billingBusy");
}
