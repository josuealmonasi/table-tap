import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

// Stripe Connect via the Accounts v2 API. New Connect platforms can no longer
// create the legacy v1 (Express/Standard/Custom) accounts, so we create a v2
// account with a "merchant" configuration (card_payments capability) and route
// each customer payment to it with a destination charge — the money lands in
// the restaurant's balance, not the platform's. v2 lives behind a preview API
// version, so these calls go through rawRequest with that version pinned.
const V2 = { apiVersion: "2026-06-24.preview" } as const;

// Minimal shapes of the v2 responses we read.
interface V2Account {
  id: string;
  configuration?: {
    merchant?: { capabilities?: { card_payments?: { status?: string } } };
    recipient?: {
      capabilities?: { stripe_balance?: { stripe_transfers?: { status?: string } } };
    };
  };
}
interface V2AccountLink {
  url: string;
}

export interface ConnectStatus {
  accountId: string | null;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
}

/** Connected-account country from the restaurant's currency (the owner edits it in onboarding). */
function countryFor(currency: string): string {
  return currency.toUpperCase() === "USD" ? "us" : "mx";
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

/** Returns the restaurant's connected-account id, creating one the first time. */
export async function ensureConnectAccount(
  restaurantId: string,
  opts: { email?: string; currency: string },
): Promise<string> {
  const { accountId } = await readConnect(restaurantId);
  if (accountId) return accountId;

  const account = (await stripe.rawRequest(
    "POST",
    "/v2/core/accounts",
    {
      ...(opts.email ? { contact_email: opts.email } : {}),
      dashboard: "express",
      identity: { country: countryFor(opts.currency), entity_type: "individual" },
      configuration: {
        // merchant → the restaurant can be shown its payments / do refunds;
        // recipient.stripe_transfers → it can RECEIVE our destination-charge
        // transfers (required, or checkout fails); payouts → withdraw to its bank.
        merchant: { capabilities: { card_payments: { requested: true } } },
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: { requested: true },
              payouts: { requested: true },
            },
          },
        },
      },
      defaults: {
        currency: opts.currency.toLowerCase(),
        responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
      },
      include: ["configuration.merchant", "configuration.recipient"],
    },
    V2,
  )) as unknown as V2Account;

  await createAdminClient()
    .from("restaurants")
    .update({ stripe_account_id: account.id })
    .eq("id", restaurantId);
  return account.id;
}

/** A Stripe-hosted onboarding URL for the connected account to finish setup. */
export async function createOnboardingLink(
  accountId: string,
  origin: string,
): Promise<string> {
  const link = (await stripe.rawRequest(
    "POST",
    "/v2/core/account_links",
    {
      account: accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["merchant"],
          return_url: `${origin}/dashboard/settings?connect=return`,
          refresh_url: `${origin}/dashboard/settings?connect=refresh`,
        },
      },
    },
    V2,
  )) as unknown as V2AccountLink;
  return link.url;
}

/** Retrieves live account state from Stripe and syncs stripe_charges_enabled. */
export async function syncConnectStatus(restaurantId: string): Promise<ConnectStatus> {
  const { accountId } = await readConnect(restaurantId);
  if (!accountId) return { accountId: null, chargesEnabled: false, detailsSubmitted: false };

  const account = (await stripe.rawRequest(
    "GET",
    `/v2/core/accounts/${accountId}?include=configuration.merchant&include=configuration.recipient`,
    {},
    V2,
  )) as unknown as V2Account;

  // Our checkout uses a destination charge, so "can accept payments" hinges on
  // the recipient being able to receive transfers — not on card_payments.
  const cfg = account.configuration;
  const chargesEnabled =
    cfg?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status === "active";
  await createAdminClient()
    .from("restaurants")
    .update({ stripe_charges_enabled: chargesEnabled })
    .eq("id", restaurantId);
  return {
    accountId,
    chargesEnabled,
    detailsSubmitted: cfg?.merchant?.capabilities?.card_payments?.status === "active",
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
