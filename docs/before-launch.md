# Before launch

Everything here is outside the code: keys, accounts and legal identity that
only the business can supply. Each one fails **silently** — the app builds,
deploys and passes every check without them, and the failure only shows up as
money that never arrives or an email nobody receives.

Last verified against production on 10 September 2026: still test keys, still
zero webhook endpoints against four connected accounts, still no mail provider.
Rechecked on 2 October 2026 from the database: none of the seven restaurants has
a Stripe Connect account yet (so no card payment of any kind can be taken), and
none has accepted the terms in force (`2026-10-02`). The Stripe dashboard and
the mail provider were not rechecked — they are not visible from the code.

## 1. The Stripe webhooks — money is not being recorded without them

**Checked 10 September 2026: zero endpoints registered, against four connected
accounts.**

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

Online card payments of every kind — an order, a table's bill, a divided share,
a customer account paid online — also need each restaurant's own **Stripe
Connect onboarding** (Settings → Pagos). Until it is done the app hides card
payment there rather than offering a button that fails.

## 2. Live Stripe keys

Production is on `sk_test_`. Nothing charges a real card until that changes.

## 3. A mail provider

Two separate things, both currently unset:

- **Receipts, and a customer account's statement by email**, need a real
  `RESEND_API_KEY` (production reads as a placeholder). Until then neither is
  offered; the statement still prints and shows on the customer's phone.
- **Staff invitations do not work at all.** Supabase has no SMTP configured, so
  it refuses valid addresses or caps at a few an hour. An owner cannot add
  their team today — the demo team exists only because the seed creates it
  directly. `pnpm api` reports this as a known skip rather than a failure.

## 4. Supabase Auth URLs

Every production auth log carries `http://localhost:3000` as its Site URL,
including the staff invite that asked to return to the Vercel domain. A
redirect not on the allow-list falls back to the Site URL, so invitation and
password-reset emails from production would link to localhost. Authentication →
URL Configuration: Site URL `https://table-tap-star.vercel.app`, redirect URL
`https://table-tap-star.vercel.app/auth/callback**`. Never exercised yet — no
production user has been invited or sent a reset.

## 5. Owners accept the terms in force

The terms and the aviso are versioned (`TERMS_VERSION`), and a restaurant on an
older version is asked to accept the current one on its next visit. Only the
owner can: it is their consent, and no script gives it for them.

## 6. Legal identity

- Razón social, RFC, domicilio fiscal.
- A published contact address for privacy requests.
- A lawyer's read of the terms and the aviso de privacidad.
- Regenerate the PDFs after any wording change: `node scripts/legal-pdf.mjs`.

## 7. The kitchen printer, when a restaurant wants one

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

## 8. Keys for features not yet built

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

A strict **Content-Security-Policy** is in place (`src/lib/csp.ts`): a
per-request nonce with `strict-dynamic`, no inline script, and `connect-src`
limited to the app and Supabase. It was written against what the app actually
fetches: Stripe Checkout is a full-page redirect rather than a frame, and the
fonts are self-hosted by `next/font`.

## What a security review found, and what it left

Swept 2026-09-09: routes and their guards, RLS under real cross-tenant attack,
storage, the money paths, injection, redirects, logging, headers and
dependencies. Six findings, all fixed and guarded, written up in
`docs/regressions.md`.

A second deep sweep on 2026-09-10 went after concurrency, the security-definer
functions and hostile input. It found three more (a tip that could make a sale
cheaper, a NaN that crashed the money route, and a cross-tenant plan lookup) and
confirmed sound: Realtime enforces RLS for signed-in users, all 19 SECURITY
DEFINER functions pin `search_path`, `reserve_stock` locks its rows in a
deterministic order, `redeem_coupon` increments atomically, and the two-person
rule on discounts holds. One thing it noted and did not fix: an anonymous
listener on Realtime receives **empty-payload** events for `orders`, so it
learns that an order happened somewhere on the platform without learning
anything about it — a timing side channel with no contents and no tenant
identity.

Two things it deliberately did NOT fix then:

- **A real Content-Security-Policy.** The session cookie cannot be `httpOnly` —
  Supabase's browser client has to read it — so any XSS is a full account
  takeover, and a CSP is the defence that actually addresses that. It has since
  been written and is live (see above).

- **`authenticated` holds Supabase's default write grants on 24 tables**
  (counted again on 2 October 2026: still 24). RLS
  covers every one of them — cross-tenant writes, the ledger, the audit log and
  the price list were all attacked directly and all held. But the schema
  already argues, for `anon`, that leaving RLS as the *only* thing between a
  browser key and the data is worth avoiding, and that argument applies here
  too. `restaurants` and `plan_limits` have been revoked because a hole was
  proved in them; the rest is defence in depth on a working defence, and worth
  doing deliberately rather than in the middle of a review.

## Keeping the demo honest

`pnpm seed:shape` (and `seed:shape:prod`) asks whether the seeded data still
looks like the app: every column the app reads filled in at least one row, cash
naming who took it, a menu that closes, a dish that counts stock, a bundle to
price. It exists because the seeder drifts silently — the schema moves and
`mock-data.mjs` does not, and the first thing to notice is a gate failing on a
clean checkout.

Worth running after any schema change that adds a column the app reasons about.

## Decided, and being done

- **Large files.** Some twenty source files exceed the ~200-line guideline in
  CLAUDE.md, led by `OrderingApp.tsx` and `checkout/route.ts`. Decided on
  2 October 2026: split them, biggest first, one PR each with behaviour
  unchanged and every gate run.
- **Settlement in one transaction**, **rate limits counted per table** with a
  room-wide ceiling, and **visit cards only from a table's or the menu's own
  page** — decided the same day, each its own PR.
