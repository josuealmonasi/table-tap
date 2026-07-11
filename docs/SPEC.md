# TableTap — Product & Technical Spec

> Working spec for the QR-code table-ordering app. This is the "land it more
> detailed" document — it captures the concept, the flows, the data model, what
> exists today, and the open decisions to make next.

## The idea

Inspired by restaurants in Japan: every table has a QR code. A diner scans it,
the restaurant's menu opens in their phone browser (no app install), they build
and customise an order, pay on the spot, and the order drops straight into the
kitchen. The diner watches the status live; staff deliver to the table because
the QR encodes which table the order came from.

Reference competitor: https://klikit.io/

## Actors

| Actor                | Needs                                                                            |
| -------------------- | -------------------------------------------------------------------------------- |
| **Diner**            | Scan → browse menu → customise items → pay → track status. No login.             |
| **Kitchen / staff**  | See incoming orders live, advance status, know the table. Login required.        |
| **Restaurant owner** | Manage menu, tables, pricing; print QR codes; see revenue. (Mostly future work.) |

## End-to-end flow

1. Diner scans QR → lands on `/r/<restaurantId>/t/<tableId>`.
2. Menu loads (public read via Supabase RLS). Diner adds items, picks modifiers,
   adds notes, sets quantity.
3. Checkout → `POST /api/checkout`:
   - Server **re-fetches every price from the DB** (never trusts the client).
   - Creates a `pending_payment` order, then a Stripe Checkout Session.
   - Returns the Stripe URL; browser redirects to it.
4. Diner pays (card / Apple Pay / Google Pay — wallets appear automatically on
   supported devices).
5. Stripe → `POST /api/webhooks/stripe` (signature-verified) → marks the order
   `paid` + `received`.
6. Diner is redirected to `/order/<orderId>` and watches status live (Supabase
   realtime subscription on that single order row).
7. Kitchen dashboard (`/dashboard`) receives the order in real time (with an
   audible ping), advances it: `received → preparing → ready → completed`.
8. Each status change pushes instantly back to the diner's tracker.

## Order status machine

```
pending_payment ──(stripe webhook: paid)──▶ received ──▶ preparing ──▶ ready ──▶ completed
                                                  └──────────────▶ cancelled
```

`pending_payment` orders are hidden from the dashboard until paid.

## Data model (see `supabase/schema.sql`)

- `restaurants` — name, branding, currency, service %, `owner_id` (the staff login).
- `restaurant_tables` — physical tables; the QR target.
- `categories` / `menu_items` — the menu. `menu_items.modifiers` is JSON:
  `[{ label, type: 'single'|'multi', options: string[] }]`.
- `orders` — snapshots the line items as JSON at purchase time (name, price, qty,
  mods, notes), plus totals, table, Stripe IDs, and status.

### Security model

- Browser uses the **publishable** Supabase key → RLS allows public read of menu
  data only.
- Orders are **created/mutated server-side only** with the secret key. The client
  cannot forge an order or change a price.
- The order id is an unguessable UUID, used as a capability token so the diner can
  track without logging in.
- Dashboard writes require the logged-in owner (RLS ties orders → restaurant →
  `owner_id`). The `/api/orders` route double-checks ownership.

## What's built today

- ✅ Customer menu + cart + modifiers + checkout (`OrderingApp`)
- ✅ Stripe Checkout + signature-verified webhook
- ✅ Live order tracker (`OrderTracker`)
- ✅ Kitchen dashboard with realtime + status buttons (`OrdersBoard`)
- ✅ Magic-link staff auth, RLS, demo seed data ("Sakura Dining")

## Open decisions / next steps

**Decide soon (they shape the build):**

- **Payments by region** — Stripe covers card + Apple/Google Pay. PayPal is a
  separate integration; confirm it's actually needed for the launch market.
- **Tipping** — common expectation in some markets, not in Japan. Add as a
  checkout line item if needed.
- **Dine-in vs takeaway / pickup** — does the QR always mean "deliver to table",
  or also support pickup?
- **Single restaurant vs SaaS** — is this one restaurant, or a platform multiple
  restaurants onboard onto? Affects billing, onboarding, subdomains.

**Build next (schema/RLS already support most):**

- Menu management UI (CRUD) for owners — currently menu is edited via SQL.
- QR code generation + printable per-table PDFs.
- Order history + basic analytics (covers, revenue, popular items).
- Call-staff / request-bill buttons from the diner's tracker.
- Allergen / dietary tags on items.
- i18n (English + the launch market's language).

## Stack

Next.js 15 (App Router) · Supabase (Postgres + Auth + Realtime + RLS) ·
Stripe Checkout · TypeScript. Deploys to Vercel.
