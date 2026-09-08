# Before launch

Everything here is outside the code: keys, accounts and legal identity that
only the business can supply. Each one fails **silently** — the app builds,
deploys and passes every check without them, and the failure only shows up as
money that never arrives or an email nobody receives.

Last verified against production on 8 September 2026.

## 1. The Stripe webhooks — money is not being recorded without them

**Checked: zero endpoints registered, against four connected accounts.**

The code is ready (two routes, one signing secret each). Until the endpoints
exist, a card payment never marks its order paid, and abandoned split shares
and stock reservations are never released.

Two endpoints, same host, because there are two Stripe accounts:

| endpoint | register as | events |
| --- | --- | --- |
| `/api/webhooks/stripe` | events on **your account** | `customer.subscription.*` |
| `/api/webhooks/stripe/connect` | events on **connected accounts** | `checkout.session.completed`, `checkout.session.expired` |

Then both signing secrets into Vercel as `STRIPE_WEBHOOK_SECRET` and
`STRIPE_WEBHOOK_SECRET_CONNECT`. Stripe issues a different one per endpoint and
the wrong one fails every event with a 400 that looks like a delivery problem.

**Proof it worked:** `pnpm money:prod` after the first real card payment. It is
the check that catches a webhook silently not firing.

## 2. Live Stripe keys

Production is on `sk_test_`. Nothing charges a real card until that changes.

## 3. A mail provider

Two separate things, both currently unset:

- **Receipts** need a real `RESEND_API_KEY` (production reads as a placeholder).
- **Staff invitations do not work at all.** Supabase has no SMTP configured, so
  it refuses valid addresses or caps at a few an hour. An owner cannot add
  their team today — the demo team exists only because the seed creates it
  directly. `pnpm api` reports this as a known skip rather than a failure.

## 4. Legal identity

- Razón social, RFC, domicilio fiscal.
- A published contact address for privacy requests.
- A lawyer's read of the terms and the aviso de privacidad.
- Regenerate the PDFs after any wording change: `node scripts/legal-pdf.mjs`.

## 5. Keys for features not yet built

- **Push notifications** need a VAPID key pair in Vercel. Everything else can
  be built without them; the sending half stays inert until they exist.
- **Menu import from a photo or PDF** needs an Anthropic API key, and costs
  real money per import — which is why it is gated to Casa and above.

## Still a decision, not a task

- **Loyalty** is parked pending the identity question: what a returning diner
  is recognised by.
- **Fifty files exceed the ~200-line guideline** in CLAUDE.md, led by
  `OrderingApp.tsx` (752) and `checkout/route.ts` (573). Pre-existing, and
  splitting them carries real regression risk, so it is a deliberate call
  rather than an oversight.
