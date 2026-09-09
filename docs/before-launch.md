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

## 5. The kitchen printer, when a restaurant wants one

Nothing to buy centrally and nothing to configure on our side: printing is off
until a restaurant turns it on, and the till's own receipt already prints
through whatever printer the counter machine can see.

What a restaurant needs for the KITCHEN printer is a CloudPRNT-capable one —
the Star TSP143IV is the cheapest that does it, the mC-Print3 if the counter is
tight — and then Settings → Impresora de cocina, switch on, "Crear la
dirección", and paste that URL into the printer's CloudPRNT server field.

The URL is the printer's only credential. If it is ever seen by somebody who
should not have it, pressing the button again revokes it, and the printer is
set up once more with the new one.

## 6. Keys for features not yet built

- **Push notifications** need a VAPID key pair in Vercel. Everything else can
  be built without them; the sending half stays inert until they exist.
- **Menu import from a photo or PDF** needs an Anthropic API key, and costs
  real money per import — which is why it is gated to Casa and above.

## Keeping the framework patched

`pnpm audit` is worth running before each release. The app's own code was clean
when this was last swept; the finding was Next itself, sitting two critical
unauthenticated RCEs behind a patch release nobody had taken.

`security-headers.spec.ts` fails if the pinned range can resolve below the
patched version, so the floor cannot drift backwards unnoticed — but it only
knows about the advisories that were open when it was written. A new one needs
a new floor.

A real **Content-Security-Policy** is still outstanding. Only `frame-ancestors`
is set today. A full policy has to be tested against Stripe Checkout, Supabase
storage and the fonts before it can be trusted, and a half-written one either
blocks checkout or lulls somebody into thinking the app has one.

## Still a decision, not a task

- **Loyalty** is parked pending the identity question: what a returning diner
  is recognised by.
- **Fifty files exceed the ~200-line guideline** in CLAUDE.md, led by
  `OrderingApp.tsx` (752) and `checkout/route.ts` (573). Pre-existing, and
  splitting them carries real regression risk, so it is a deliberate call
  rather than an oversight.
