# TableTap — Product & Technical Spec

> What the app is, who uses it, how the money moves, and how it is kept honest.
> Written against the code: every claim here can be checked in the file it names.
> Last rewritten 4 Sep 2026 — the previous version described the July prototype
> and had gone badly stale (it still said the menu was edited by SQL).

## The idea

Every table has a QR code. A diner scans it, the restaurant's menu opens in
their phone browser — no app to install — they build an order, and it drops
straight into the kitchen. The diner watches it live; staff know which table it
came from because the QR said so.

It is a **platform**, not one restaurant's app: restaurants sign themselves up,
pick a plan, connect their own Stripe account and get paid directly. Launch
market is Mexico — prices in MXN, interface in Spanish with English alongside.

## Actors

| Actor | Reaches | Needs |
| --- | --- | --- |
| **Diner** | the QR, no login | browse, order, pay, track, rate, ask for the bill |
| **Kitchen** | `/dashboard/orders` | the board, and nothing that costs money |
| **Waiter** | orders + open bills | collect, ask for a discount or a write-off |
| **Cashier** | orders + open bills | take money at the till, see their own takings |
| **Manager** | most of the dashboard | the menu, promotions, approvals, the daily count |
| **Owner** | all of it | plan, billing, staff, Stripe, settings |
| **Platform admin** | `/dashboard/admin` | every restaurant and login, ours alone |

Staff roles live in `staff`; `MANAGES(role)` in `src/lib/membership.ts` is the
line between running the business and working a shift. A platform admin is a
row in `platform_admins`, which no browser can read.

## The two ways in

- **A table QR** → `/r/<restaurantId>/t/<tableId>`. The order knows its table,
  the bill can stay open, and a waiter collects at the end.
- **The general QR** → `/r/<restaurantId>`. No table: the diner pays online, or
  walks to the till with a code. Counter orders can carry a name so the cashier
  can call it out.

The difference is not a setting. What changes is **who holds the order** — a
table holds its own, and where there is no table the counter does.

## End to end

1. Scan → the menu loads (public read, RLS-filtered).
2. Add items, modifiers, extras, a note for the kitchen, a coupon.
3. Checkout → `POST /api/checkout`, which is the only authoritative money path:
   - re-fetches **every price from the database**, never trusting the client
   - reserves stock before asking for money, so two tables cannot both be sold
     the last portion while each sits on a payment page
   - claims the coupon atomically, applies promotions, computes the fee
   - creates the order, then a Stripe Checkout Session **on the restaurant's own
     connected account** with our `application_fee_amount`
4. Stripe → `POST /api/webhooks/stripe`, signature-verified → the order becomes
   `paid` + `received`. An expired session hands back the stock and the coupon.
5. The diner watches `/order/<orderId>` — the id is the capability; no login.
6. The board advances it; each change reaches the diner's tracker.

Where the plan allows it, food can leave **before** it is paid for: at a table
the bill stays open and a waiter settles it; on the general QR the diner pays at
the till. Then the money path is `/api/table-payment` or `/api/bill/pay`.

## Order status

```
pending_payment ──(webhook: paid)──▶ received ──▶ preparing ──▶ ready ──▶ completed
                                          └──────────────────────────▶ cancelled
```

`pending_payment` never reaches the board. An order that is delivered before it
is paid rides the same track and carries its debt on the bills screen instead.

## Money

- **Stripe Connect, direct charges.** The restaurant's account takes the payment;
  we take an `application_fee_amount`. It used to be a destination charge on our
  platform, which had Stripe billing *us* for every order.
- **Plans** (`plan_limits`): `carta` free, `servicio`, `casa`, `grupo`. Each row
  carries the ceilings (tables, staff, menus, items) and the feature flags:
  dine-in, menu schedules, deferred payment, promotions, coupons, staff
  discounts, inventory. `can(limits, feature)` is the only way to ask.
- **Founding price**: the first restaurants on a paid tier keep the price they
  came in at. `claim_founding_price` serialises the assignment with an advisory
  lock so two simultaneous subscribers cannot take the same place.
- **Coupons and promotions** are reserved and released like stock, for the same
  reason: a code with two uses left must not be spent three times.
- **Discounts and write-offs** are requests a waiter raises and a manager
  approves — `discount_requests`, `write_off_requests` — so the person who gives
  money away is never the person who asks.
- **A table can divide its bill evenly.** It stays a proposal until every
  person has joined, and the last one to join **freezes** it: the table divides
  what it owed at that instant, the odd cent goes to whoever asked (MX$10
  between three is 3.34 / 3.33 / 3.33), and anything ordered afterwards belongs
  to whoever ordered it. Freezing is what lets a table keep ordering while the
  others are paying, which is money that would otherwise be turned away. Food
  and the service charge are divided; the tip is each person's own. A share is
  money against the *sitting* rather than any order, so the floor's bill screen
  says how much of it is already in — a waiter taking cash for a table that has
  half-paid by card is how the same money gets collected twice.
- **`payments` is the ledger of money that arrived**, as opposed to
  `orders.paid`, which only says an order is settled. That boolean is enough
  while a payment always covers whole orders and stops being enough the moment a
  table divides a bill: a third of MX$100 across orders of MX$60 and MX$40 is an
  amount belonging to no order. Every route that marks an order paid records the
  payment in the same breath; two invariants and `pnpm money` are what keep the
  two records from drifting apart.
- **Corte de caja**: the day's takings by whoever took them, laid out as a sum.

## Data model

`supabase/schema.sql` is one idempotent script; git history is the changelog.
Twenty-six tables, in groups:

- **The restaurant** — `restaurants`, `staff`, `profiles`, `platform_admins`,
  `plan_limits`, `user_logs`
- **The menu** — `menus`, `categories`, `menu_items`, `item_addons`,
  `dietary_tags`, `icon_groups`, `icon_group_items`
- **Selling** — `orders`, `payments`, `table_sessions`, `restaurant_tables`,
  `service_requests`, `dish_ratings`, `bill_splits`, `bill_split_claims`
- **Offers** — `promotions`, `promotion_items`, `coupons`, `coupon_redemptions`
- **Money asked for** — `discount_requests`, `write_off_requests`
- **Telling people** — `notifications`
- **Keeping the door shut** — `rate_limits`

`orders` snapshots its line items as JSON at purchase time, so a menu edited
tomorrow never rewrites what someone bought today.

## Security

Assume the browser is hostile; it holds the publishable key and nothing else.

- **RLS on every table**, and a policy is not optional: a table with RLS and no
  policy denies everything, which is how `platform_admins` is protected.
- **Column grants, not just row policies.** `restaurants` is publicly readable by
  row — the menu hangs off a QR — so the private columns (owner, plan, billing
  state, Stripe account) are granted explicitly and read only with the service
  key. A row policy alone had leaked them to any signed-in account.
- **Writes that matter are server-only**, with the secret key, always scoped by
  the caller's restaurant. PostgREST returns no error when RLS filters a write to
  zero rows, so the routes check what actually changed.
- **`security definer` functions** — `reserve_stock`, `release_stock`,
  `redeem_coupon`, `rate_limit_hit`, `claim_founding_price`, `open_table_session`
  — pin `search_path` and are executable by `service_role` alone. Postgres grants
  EXECUTE to PUBLIC by default, so every one of them is revoked explicitly.
- **Capability tokens**: an order id is unguessable, and that is what lets a diner
  track without an account. Public routes that take one are rate-limited.
- **No secret can reach a client component** — an invariant walks the real import
  graph, counting only imports that survive compilation.

## What exists

Diner: menu with categories, search, dietary filters, combos and offers, item
modifiers and extras, cart, coupons, tips, card payment, pay-at-the-end,
pay-at-the-counter, live tracker with a QR staff can scan, receipts by email,
dish ratings, ES/EN.

Restaurant: multiple menus with schedules, full menu editing, dietary tags and
icon groups, tables with printable QR codes, the orders board, open bills,
discounts and write-offs with approval, promotions and coupons, inventory with
low-stock alerts, analytics, corte de caja, staff and roles, plan and billing,
Stripe onboarding, activity log, notifications bell.

Platform: sign-up, plans, founding prices, the admin console, legal documents
generated as PDFs from the same source the app renders.

## How it is kept honest

The gate, all of which must pass before anything ships:

| command | what it proves |
| --- | --- |
| `pnpm test` | the pure logic, and the invariants that span files |
| `pnpm api` | all 38 routes answer a legitimate request correctly |
| `pnpm rls` | nothing is exposed: every browser-reachable read, as every role |
| `pnpm roles` | each role reaches its own screens and no others |
| `pnpm smoke` | every page renders |
| `pnpm layout` | every screen reads at 390 / 820 / 1280 |
| `pnpm promises` | no screen offers what the system will refuse |
| `pnpm dialogs` | every dialog, found by opening it rather than by listing it |
| `pnpm money` | the ledger and the orders tell the same story |

Two rules behind them, both learned the hard way. **A check only covers what is
on its list** — invariants now fail when a route or screen exists that nothing
checks. And **static guesses lie**: when the question is what a person actually
gets, measure it in a browser.

`docs/regressions.md` is the list of bugs that have really shipped here and what
now catches each one.

## Stack

Next.js 15 (App Router) · Supabase (Postgres, Auth, Realtime, RLS) · Stripe
Connect · TypeScript · pnpm · Node 22. Deployed on Vercel. Email/password auth
for staff, invitations for the team.

## Still open

Not code — the things only the business can do: registering the Stripe webhook
with Connect events, live Stripe keys, a published contact address for privacy
requests, razón social / RFC / domicilio, a lawyer's read of the legal text, and
a mail provider for receipts and staff invitations.
