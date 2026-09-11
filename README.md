# 🌸 TableTap

Table service for restaurants, from either side. A diner scans the QR at their
table, browses the menu, customises and pays (card / Apple Pay / Google Pay via
Stripe) — or a waiter takes the order on their own phone, carries the plates out
and collects the bill in cash, by card, in equal parts or a hundred pesos at a
time. There is a counter till for walk-ins, a kitchen board that keeps working
when the wifi does not, and tickets on paper for the pass.

Built with **Next.js (App Router) · Supabase · Stripe**.

📄 **Product & technical spec:** [`docs/SPEC.md`](docs/SPEC.md) — concept, flows,
data model, security, and the open decisions to make next.

---

## What's in here

```
supabase/{schema,seed,drop,purge}.sql     ← DDL + seed + reset SQL (run via pnpm db:*)
scripts/                                  ← the gates: api, rls, roles, smoke, layout,
                                            promises, money, attack, dialogs (pnpm <name>)
src/lib/supabase/{client,server,admin}.ts ← 3 Supabase clients (publishable + secret)
src/lib/csp.ts                            ← what the browser may load and talk to
src/middleware.ts                         ← refreshes auth sessions, writes the policy
src/lib/legal/                            ← the terms and the aviso, and the PDFs built
                                            from them (node scripts/legal-pdf.mjs)
src/app/r/[restaurantId]/t/[tableId]/     ← the diner's menu and bill (QR target)
src/app/order/[orderId]/                  ← live order tracking
src/app/dashboard/orders/                 ← the kitchen board, and what is ready to carry
src/app/dashboard/table-order/            ← the waiter's pad
src/app/dashboard/bills/                  ← open bills, collecting, the calculator
src/app/dashboard/pos/                    ← the counter till
src/app/dashboard/[menu]/                 ← menus, sections, products, extras
src/app/dashboard/{tables,promotions,analytics,settings,staff,plan,admin}/
src/app/api/checkout/                     ← prices a cart and opens Stripe Checkout
src/app/api/webhooks/stripe{,/connect}/   ← the only place a payment is believed
src/app/api/table-{order,bill,payment}/   ← what the waiter takes and collects
src/app/api/print/cloudprnt/[token]/      ← what a kitchen printer asks for
src/app/globals.css                       ← design system
```

---

## Setup (≈20 min)

> Requires **Node ≥ 18.18** (Next.js 15). An `.nvmrc` pins Node 22 — run `nvm use`.

### 0. Install dependencies

This is a complete Next.js project — just install and go.

```bash
nvm use            # or ensure your node is ≥ 18.18
corepack enable    # makes the pinned pnpm available
pnpm install
```

### 1. Environment variables — dev & prod are separate

The app uses **two Supabase projects** so development never touches production
data. Config lives in per-environment files (all gitignored):

| File                     | Used by                                | Points at                      |
| ------------------------ | -------------------------------------- | ------------------------------ |
| `.env.development.local` | `pnpm dev`, `pnpm db:*`                | your **dev** Supabase project  |
| `.env.production.local`  | `pnpm build`/`start`, `pnpm db:*:prod` | your **prod** Supabase project |

```bash
cp .env.development.local.example .env.development.local   # fill in dev keys
cp .env.production.local.example  .env.production.local    # fill in prod keys (later)
```

Each needs the Supabase URL + keys, Stripe keys, and a `DATABASE_URL` (Supabase →
**Connect** → _Session pooler_ URI, with your DB password). Next.js loads the
right file automatically based on `NODE_ENV`.

### 2. Create the database

With `DATABASE_URL` set in `.env.development.local`:

```bash
pnpm db:reset      # drop + create + seed the dev database, prints a demo URL
```

**Database scripts** (default = dev; append `:prod` to target production, which
prompts for confirmation on destructive ops):

| Command          | What it does                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `pnpm db:create` | Create tables / RLS / realtime (structure only).                                            |
| `pnpm db:seed`   | Insert the demo restaurant + menu, and (dev only) create the test logins below. Idempotent. |
| `pnpm db:reset`  | Drop + create + seed — a clean slate. Use this most.                                        |
| `pnpm db:purge`  | Empty every table, keep the structure.                                                      |
| `pnpm db:drop`   | Drop all tables entirely.                                                                   |
| `pnpm db:mock`   | Add a self-contained demo restaurant ("Demo Bistro") with a full menu, ~250 orders across 30 days, a named team, live orders and service requests — everything to present the app. Repeatable. |
| `pnpm db:dropmock` | Remove **only** the demo data (Demo Bistro + its logins); leaves the base seed untouched.  |
| `…:prod`         | Same, against the prod DB (e.g. `pnpm db:create:prod`, `pnpm db:mock:prod`).                |

> Prefer the dashboard? You can still paste `supabase/schema.sql` (then
> `supabase/seed.sql`) into the Supabase **SQL Editor** and **Run**.

### 3. Run locally & sign in

```bash
pnpm dev
```

- Restaurant: open `http://localhost:3000/signup` to create an account (this also
  creates your restaurant), then you land on `/dashboard`. Sign in again any time
  at `http://localhost:3000/login`.
- **Test logins (dev only):** `pnpm db:seed` / `pnpm db:reset` create five ready
  accounts, password `test123`, each with its own "Test Restaurant N" — and each
  on a different plan, so every tier can be demonstrated by signing in rather
  than by editing the database. These are **never** created on prod.

  | login | plan | what it is for |
  | --- | --- | --- |
  | `test1@tabletap.dev` | **Carta** (free) | The gates. Table QRs fall back to the counter menu, coupons and promotions are refused, the dish ceiling bites. It keeps the tables and dishes the seed built, which is what a real downgrade looks like. |
  | `test2@tabletap.dev` | **Servicio** | The entry paid tier: tables, open bills, promotions. No coupons, no menu schedules. |
  | `test3@tabletap.dev` | **Casa** | Everything that is buyable — coupons, menu schedules, staff discounts, a year of analytics. |
  | `test4@tabletap.dev` | **Grupo** | What the top tier unlocks, before the tier itself is finished. |
  | `test5@tabletap.dev` | **Servicio, trial expired yesterday** | A lapsed trial without waiting thirty days for one: the app settles it to Carta on the first request, exactly as it would in life. |
- Customer menu: `http://localhost:3000/r/<restaurantId>/t/<tableId>` — `pnpm db:reset`
  prints a ready-to-open demo URL.
- **Presentation data:** `pnpm db:mock` builds "Demo Bistro" — a fully populated
  restaurant to demo every feature (orders board, analytics, service requests,
  staff). Logins: `demo@tabletap.dev` (owner), `demo-manager@`, `demo-waiter@`,
  `demo-cashier@`, `demo-kitchen@`, password `demo123`. Run `pnpm db:dropmock` to remove it again.

### 4. Stripe test payments locally

Install the Stripe CLI, then forward webhooks to your local server:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET` in
`.env.development.local`. Use test card `4242 4242 4242 4242`, any future expiry,
any CVC.

---

## Deploy to Vercel

1. Push to GitHub (you've done this).
2. vercel.com → **Add New → Project** → import your repo.
3. Under **Environment Variables**, add all the keys from your
   `.env.production.local` (paste the **secret** values here directly — they live
   only in Vercel, never in chat or git).
4. Deploy. You'll get a URL like `https://tabletap.vercel.app`.
5. **Add BOTH production webhooks.** There are two Stripe accounts in play, so
   there are two endpoints, each with its own signing secret:

   | endpoint | register as | events |
   | --- | --- | --- |
   | `/api/webhooks/stripe` | events on **your** account | `customer.subscription.*` |
   | `/api/webhooks/stripe/connect` | events on **connected accounts** | `checkout.session.completed`, `checkout.session.expired` |

   Their secrets go into Vercel as `STRIPE_WEBHOOK_SECRET` and
   `STRIPE_WEBHOOK_SECRET_CONNECT`. The wrong one fails every event with a 400
   that looks like a delivery problem. Until they exist a card payment never
   marks its order paid — `pnpm money:prod` is the check that catches it.

See [`docs/before-launch.md`](docs/before-launch.md) for the rest of what only
the business can supply: live keys, a mail provider, and the legal identity.

---

## How it stays secure

- The **publishable** Supabase key ships to the browser and only ever reads public
  menu data (Row Level Security enforces this).
- Orders can **only be created/modified server-side** with the secret key — the
  browser cannot forge an order or change its price. The checkout API re-fetches
  every item's real price from the database before charging.
- The order id is an unguessable UUID, used as a capability token so the customer
  can track their order without logging in.
- Dashboard writes require a logged-in owner; RLS ties each restaurant to its
  `owner_id`.
- Every response carries a **Content-Security-Policy with a per-request nonce**
  (`src/lib/csp.ts`): no inline script anywhere, and `connect-src` limited to us
  and Supabase, so a script that somehow ran has nowhere to send a bill.
- `pnpm rls` attacks all 21 tenant tables as all six roles, and `pnpm attack`
  asks what a signed-in person can do that they should not — judged on whether
  a peso moved, never on the absence of an error.

---

## Not yet built

- **Push notifications** — the sending half is inert until a VAPID key pair
  exists in Vercel.
- **Menu import from a photo or a PDF** — needs an Anthropic key and costs real
  money per import, which is why it is gated to Casa and above.
- **One login across several restaurants** — what the Grupo tier is waiting on.
  Grupo is priced per location, never as a flat bundle.
- **PayPal**, as a Stripe payment method or its own SDK.

---

## Where the rest is written down

- [`docs/SPEC.md`](docs/SPEC.md) — what the app is: the flows, the money, the
  roles, and why each decision went the way it did.
- [`docs/regressions.md`](docs/regressions.md) — every bug that has actually
  shipped here, and what now catches each one automatically.
- [`docs/before-launch.md`](docs/before-launch.md) — the things outside the code
  that only the business can supply, and what each one breaks while it is missing.
- [`CLAUDE.md`](CLAUDE.md) — how code is written here, and the gate to run
  before shipping anything.
