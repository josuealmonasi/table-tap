import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

// Stripe Connect via the Accounts v2 API. New Connect platforms can no longer
// create the legacy v1 (Express/Standard/Custom) accounts, so we create a v2
// account with the "merchant" configuration only. Every diner payment is a
// DIRECT charge, made on the restaurant's own account (`stripeAccount`), and
// that is what `merchant` is for: `card_payments` to take the card, and the
// payouts to the restaurant's bank that come with it. The `recipient`
// configuration is for transfers from the platform — destination charges —
// which nothing here makes. v2 lives behind a preview API version, so these
// calls go through rawRequest with that version pinned.
const V2 = { apiVersion: "2026-06-24.preview" } as const;

// Minimal shapes of the v2 responses we read.
interface V2Account {
  id: string;
  configuration?: {
    merchant?: { capabilities?: { card_payments?: { status?: string } } };
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
      // Card payments, nothing else. Asking for `recipient` as well made Stripe
      // refuse the whole account ("payouts: Unknown field" once the preview
      // moved payouts into `merchant`), so no restaurant could connect at all.
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } },
      },
      defaults: {
        currency: opts.currency.toLowerCase(),
        responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
      },
      include: ["configuration.merchant"],
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
    `/v2/core/accounts/${accountId}?include=configuration.merchant`,
    {},
    V2,
  )) as unknown as V2Account;

  // A direct charge needs the restaurant's own `card_payments`. This used to
  // wait for `recipient.stripe_transfers` instead — a capability for transfers
  // nothing here makes — so a restaurant could finish onboarding and never be
  // offered to its diners. "pending" is Stripe reviewing what was submitted.
  const cardPayments = account.configuration?.merchant?.capabilities?.card_payments?.status;
  const chargesEnabled = cardPayments === "active";
  await createAdminClient()
    .from("restaurants")
    .update({ stripe_charges_enabled: chargesEnabled })
    .eq("id", restaurantId);
  return {
    accountId,
    chargesEnabled,
    detailsSubmitted: cardPayments === "active" || cardPayments === "pending",
  };
}
