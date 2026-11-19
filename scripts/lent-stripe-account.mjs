// The fake Stripe account ids the gates lend a restaurant so a route takes
// cards ("acct_api_check", "acct_api_check_account", …). They are never real,
// so nothing may treat one as the account to keep or to put back.
//
// A run stopped mid-case once left Demo Bistro on acct_api_check. Every later
// case then saved that fake as the "original" and restored it, and reseeding
// kept it too (it preserves a real test account across reseeds), so every
// card route and the attack gate's admission case failed on all later runs.
export const LENT_ACCOUNT_PREFIX = "acct_api_check";

/** Whether a stored account id is a gate's lend rather than a real account. */
export function isLentAccount(id) {
  return typeof id === "string" && id.startsWith(LENT_ACCOUNT_PREFIX);
}

/** What to put back after lending: the real account, or none if the "original" was itself a lend. */
export function accountToRestore(was) {
  if (!was?.stripe_account_id || isLentAccount(was.stripe_account_id)) {
    return { stripe_account_id: null, stripe_charges_enabled: false };
  }
  return { stripe_account_id: was.stripe_account_id, stripe_charges_enabled: was.stripe_charges_enabled ?? false };
}
