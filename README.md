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
supabase/schema.sql                      ← run this in Supabase SQL Editor
src/lib/supabase/{client,server,admin}.ts ← 3 Supabase clients (publishable + secret)
src/lib/stripe.ts                         ← server Stripe instance
src/lib/types.ts                          ← shared types
src/middleware.ts                         ← refreshes auth sessions
src/app/page.tsx                          ← landing
src/app/r/[restaurantId]/t/[tableId]/     ← customer menu + ordering (QR target)
src/app/order/[orderId]/                  ← live order tracking
src/app/dashboard/                        ← restaurant staff board (login required)
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

### 1. Environment variables
Copy `.env.local.example` → `.env.local` and fill in your values.
`.env.local` is gitignored by default — never commit it.

### 2. Create the database
Supabase dashboard → **SQL Editor** → New query → paste all of
`supabase/schema.sql` → **Run**. This creates the tables, security rules, realtime,
and a demo "Sakura Dining" restaurant.

Then grab your demo IDs:
```sql
select id, name from restaurants;
select id, label from restaurant_tables order by label::int;
```
Your customer URL is `/r/<restaurantId>/t/<tableId>`.

### 3. Link your dashboard login to the restaurant
The dashboard uses a magic-link login. After you sign in once (step 6), copy your
user id from Supabase → **Authentication → Users**, then:
```sql
update restaurants set owner_id = '<your-user-uuid>' where name = 'Sakura Dining';
```

### 4. Run locally
```bash
pnpm dev
```
- Customer: `http://localhost:3000/r/<restaurantId>/t/<tableId>`
- Dashboard: `http://localhost:3000/dashboard`

### 5. Stripe test payments locally
Install the Stripe CLI, then forward webhooks to your local server:
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```
Copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET` in `.env.local`.
Use test card `4242 4242 4242 4242`, any future expiry, any CVC.

---

## Deploy to Vercel

1. Push to GitHub (you've done this).
2. vercel.com → **Add New → Project** → import your repo.
3. Under **Environment Variables**, add all the keys from your `.env.local`
   (paste the **secret** values here directly — they live only in Vercel, never in chat or git).
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
