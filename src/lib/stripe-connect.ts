import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

// Stripe Connect (Express accounts + destination charges): each restaurant
// connects its own Stripe account, and customer payments are routed there so
// the money lands in THEIR balance, not the platform's. These helpers all use
// the secret key — the stripe_account_id column is never exposed to clients.

export interface ConnectStatus {
  accountId: string | null;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
}

/** The restaurant's stored Connect fields (server-only columns). */
export async function readConnect(
  restaurantId: string,
): Promise<{ accountId: string | null; chargesEnabled: boolean }> {
  const { data } = await createAdminClient()
    .from("restaurants")
    .select("stripe_account_id, stripe_charges_enabled")
    .eq("id", restaurantId)
    .single();
  return {
    accountId: (data?.stripe_account_id as string | null) ?? null,
    chargesEnabled: Boolean(data?.stripe_charges_enabled),
  };
}

/** Returns the restaurant's Express account id, creating one the first time. */
export async function ensureConnectAccount(restaurantId: string): Promise<string> {
  const { accountId } = await readConnect(restaurantId);
  if (accountId) return accountId;

  const account = await stripe.accounts.create({
    type: "express",
    metadata: { restaurant_id: restaurantId },
  });
  await createAdminClient()
    .from("restaurants")
    .update({ stripe_account_id: account.id })
    .eq("id", restaurantId);
  return account.id;
}

/** Retrieves live account state from Stripe and syncs stripe_charges_enabled. */
export async function syncConnectStatus(restaurantId: string): Promise<ConnectStatus> {
  const { accountId } = await readConnect(restaurantId);
  if (!accountId) return { accountId: null, chargesEnabled: false, detailsSubmitted: false };

  const account = await stripe.accounts.retrieve(accountId);
  const chargesEnabled = Boolean(account.charges_enabled);
  await createAdminClient()
    .from("restaurants")
    .update({ stripe_charges_enabled: chargesEnabled })
    .eq("id", restaurantId);
  return {
    accountId,
    chargesEnabled,
    detailsSubmitted: Boolean(account.details_submitted),
  };
}

/**
 * The platform's cut of an order, in the smallest currency unit (cents), taken
 * as an application fee on the destination charge. Set PLATFORM_FEE_BPS (basis
 * points, e.g. 250 = 2.5%) to enable it; defaults to 0 (no fee).
 */
export function platformFeeCents(totalCents: number): number {
  const bps = Number(process.env.PLATFORM_FEE_BPS) || 0;
  if (bps <= 0) return 0;
  return Math.round((totalCents * bps) / 10000);
}
