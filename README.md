# 🌸 TableTap

QR-code table ordering for restaurants. A customer scans the QR at their table,
browses the menu, customises and pays (card / Apple Pay / Google Pay via Stripe),
and the order lands live on the restaurant dashboard. Status updates flow back to
the customer's phone in real time.

Built with **Next.js (App Router) · Supabase · Stripe**.

📄 **Product & technical spec:** [`docs/SPEC.md`](docs/SPEC.md) — concept, flows,
data model, security, and the open decisions to make next.

---

## What's in here

```
supabase/{schema,seed,drop,purge}.sql     ← DDL + seed + reset SQL (run via pnpm db:*)
scripts/db.mjs                            ← db runner (create/seed/reset/drop/purge, dev|prod)
src/lib/supabase/{client,server,admin}.ts ← 3 Supabase clients (publishable + secret)
src/lib/stripe.ts                         ← server Stripe instance
src/lib/types.ts                          ← shared types
src/middleware.ts                         ← refreshes auth sessions
src/app/page.tsx                          ← landing
src/app/login/, src/app/signup/           ← restaurant email+password auth
src/app/api/signup/                       ← creates user + restaurant
src/app/r/[restaurantId]/t/[tableId]/     ← customer menu + ordering (QR target)
src/app/order/[orderId]/                  ← live order tracking
src/app/dashboard/                        ← restaurant dashboard home (login required)
src/app/dashboard/menu/                   ← menu manager (sections, products, add-ons)
src/app/api/checkout/                     ← creates order + Stripe Checkout session
src/app/api/webhooks/stripe/              ← marks order paid → 'received'
src/app/api/orders/                       ← status updates (owner only)
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

| File | Used by | Points at |
| --- | --- | --- |
| `.env.development.local` | `pnpm dev`, `pnpm db:*` | your **dev** Supabase project |
| `.env.production.local` | `pnpm build`/`start`, `pnpm db:*:prod` | your **prod** Supabase project |

```bash
cp .env.development.local.example .env.development.local   # fill in dev keys
cp .env.production.local.example  .env.production.local    # fill in prod keys (later)
```

Each needs the Supabase URL + keys, Stripe keys, and a `DATABASE_URL` (Supabase →
**Connect** → *Session pooler* URI, with your DB password). Next.js loads the
right file automatically based on `NODE_ENV`.

### 2. Create the database
With `DATABASE_URL` set in `.env.development.local`:

```bash
pnpm db:reset      # drop + create + seed the dev database, prints a demo URL
```

**Database scripts** (default = dev; append `:prod` to target production, which
prompts for confirmation on destructive ops):

| Command | What it does |
| --- | --- |
| `pnpm db:create` | Create tables / RLS / realtime (structure only). |
| `pnpm db:seed` | Insert the demo restaurant + menu, and (dev only) create the test logins below. Idempotent. |
| `pnpm db:reset` | Drop + create + seed — a clean slate. Use this most. |
| `pnpm db:purge` | Empty every table, keep the structure. |
| `pnpm db:drop` | Drop all tables entirely. |
| `…:prod` | Same, against the prod DB (e.g. `pnpm db:create:prod`). |

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
  accounts — `test1@tabletap.dev` … `test5@tabletap.dev`, password `test123`,
  each with its own "Test Restaurant N". These are **never** created on prod.
- Customer menu: `http://localhost:3000/r/<restaurantId>/t/<tableId>` — `pnpm db:reset`
  prints a ready-to-open demo URL.

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
5. **Add the production webhook:** Stripe dashboard → Developers → Webhooks →
   **Add endpoint** → URL = `https://YOUR-APP.vercel.app/api/webhooks/stripe`,
   event = `checkout.session.completed`. Copy the new `whsec_...` into Vercel's
   `STRIPE_WEBHOOK_SECRET` and redeploy.

That's it — you're live.

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

---

## Roadmap (not yet built)

- PayPal (add as a Stripe payment method or separate SDK)
- Menu management UI (CRUD) — schema + RLS already support it
- QR code generation + printable PDFs per table
- Analytics dashboard
- Multi-restaurant SaaS onboarding

---

## A note on the customer/dashboard sync demo

In the earlier prototype the order status auto-advanced on a timer so you could see
the flow. In this real version, status changes happen when **kitchen staff tap the
buttons** on the dashboard — and the customer's tracking screen updates instantly via
Supabase realtime. To demo: open the customer URL and the dashboard side by side,
place an order, then advance it from the dashboard.
