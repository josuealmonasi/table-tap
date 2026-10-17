# Billing recovery and restaurant deletion

One service-only record in `restaurant_billing_operations` holds the claim,
its latest heartbeat, and every observed Stripe customer, Checkout session and
subscription ID. It has no restaurant foreign key: deletion must not erase
billing history needed for retries. Releases clear the token, retaining IDs.

A request with a claim younger than 15 minutes asks the owner to finish on any
open payment page or retry after 15 minutes. After that, the next request lists
Stripe customers directly (metadata search can lag), then all open subscription
Checkout sessions and non-final subscriptions for the restaurant's known and
recovered customers. It records these IDs atomically when replacing the exact
expired token. An unreadable Stripe state never permits takeover. Concurrent
recovery and heartbeats are resolved by the database token/expiry check.

Every external write checks the token again and refreshes the heartbeat. A
resumed old worker cannot start another write after takeover. Charge-creating
writes use idempotency keys and explicit 30-second timeouts with one retry,
well below the recovery interval. Unknown outcomes retain the claim until
reconciliation; a cleanup failure does not discard a successful payment URL.

Checkout reuses the pending link for the chosen tier. Choosing a different tier
expires the older link first. Existing active/trialing contracts change their
one subscription item, with immediate prorations and `error_if_incomplete`.
Unsettled subscriptions offer their existing hosted invoice, or the billing
portal to update payment details. They never open a second subscription.
Multiple live contracts require support review rather than guessing which one
represents the restaurant's intended payment.

Platform restaurant deletion records its intent and all IDs, expires open
subscription links, re-reads subscriptions, cancels every live contract
immediately, and re-reads Stripe to confirm termination. Only then are staff
logins and the restaurant removed. A failed cancellation retains both; a failed
local deletion can be retried without repeating canceled contracts. The owner
cancel/resume API still preserves the paid period using cancel_at_period_end.

Apply `supabase/schema.sql` before deploying these routes. The table and four
RPCs are new; no existing RPC signature changes. `supabase/drop.sql` includes
reset parity. No billing data migration is needed for the prelaunch test setup.

Claude must run isolated billing API/concurrency, RLS/grant and payment gates.
Unit tests mock Stripe and Supabase; SQL contract tests check declarations and
do not execute PostgreSQL. Check the plan screen with USD menu currency and
MXN monthly subscriptions. D5 (actual Price entitlement mapping), D6–D10 and
D12–D13 remain separate audit work; D11 is included in this patch.

The update flow follows Stripe's
[subscription update API](https://docs.stripe.com/api/subscriptions/update).
Customer discovery uses the
[customer list API](https://docs.stripe.com/api/customers/list), avoiding
[eventually consistent search](https://docs.stripe.com/api/customers/search).
Database functions keep the
[Supabase execution privilege boundary](https://supabase.com/docs/guides/database/functions).
