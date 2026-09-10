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
- **Two Stripe accounts, so two webhooks.** A diner's food is a DIRECT charge
  on the restaurant's own Stripe account: Stripe's processing fee comes out of
  their balance and our per-order fee comes to us clean. As a destination
  charge on the platform it billed *us* MX$13.80 on a MX$300 ticket against
  MX$0.75 collected, and every restaurant we signed made that worse. The
  consequence is that a diner's events fire on the restaurant's account and a
  subscription's fire on ours — separate streams with separate signing secrets,
  so `/api/webhooks/stripe` takes our own account's events and
  `/api/webhooks/stripe/connect` takes the restaurants'. One secret each: an
  endpoint that tries several can no longer say which account sent it.
- **Corte de caja**: the day's takings by whoever took them, laid out as a sum,
  and the till each of them can count on their own. Both read `payments`, where
  an amount is a number the database checked. They used to be parsed out of the
  activity log's `amount=120 method=cash` sentence, which made the money a
  cashier signs for a substring — and the ledger and the log, two records of one
  night, had nothing comparing them. `pnpm money` now reconciles them per person
  and method. Money given up (write-offs, discounts) still comes from the log,
  because money that never arrived cannot be in a payments table. Card paid
  online is reported apart from every drawer: it is real, and nobody was
  standing there to put it in one.

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

## The counter till

A cashier rings a sale face to face, takes cash or a card on the restaurant's
own terminal, and the order lands on the pass already paid for. The customer is
called by name when it is ready; there is nothing for them to track, because
they never had a phone in this at all.

**No Stripe touches it**, which is the whole shape of the feature. Nothing is
written while the cart is being built, so an order abandoned half-rung leaves
nothing behind and holds no stock — and there is no async payment to wait for,
so one request creates the order already paid and already received. `pos_ref`
makes that request idempotent: sent twice, it answers with the ticket that
already exists rather than charging again.

Because none of that money reaches Stripe there is **no per-order fee** to
take; the subscription is what pays for the till, and it is on the paid tiers
for that reason. Not on `carta`, even though carta is the counter tier: carta
is how a restaurant tries us, and this is the feature that replaces the
register they already own.

Prices come from the database through the same `verifyCart` and `priceCart` the
diner's own cart runs, so a dish cannot cost one thing at the counter and
another on a QR. Stock is taken before any payment is recorded — if the last
portion went while the cashier was ringing it up, the sale is refused and names
what is short, rather than selling food the kitchen cannot make.

Charging opens one modal: the tip, a name to call them by, a special request,
and an address for the receipt. Filled in or left blank, one button sends it;
clicking outside closes and changes nothing, because a stray click must never
take money. No address means the ticket prints — through the browser for now,
with `printReceipt()` as the single seam a Bluetooth thermal driver replaces.
An address that the mail never reached falls back to printing rather than
leaving the cashier with nothing.

The tip is priced by the same `priceCart` the diner's cart runs, so an exact
tip is capped at the subtotal by the engine rather than trusted from the till.

The cart lives in the cashier's own browser until it is charged, so an
accidental reload does not lose a half-rung sale — a counter is the worst place
to start an order again with the customer still standing there.

The cashier may ask for a name (to call them) and an address (to send the
receipt instead of printing). The address is used for that one message and
never stored, exactly as the diner's own receipt works — the privacy notice
makes that promise and the schema keeps it.

Owner, manager and cashier. Not the waiter: carrying a card machine to a table
is settling a bill somebody else placed, which is a different act from ringing
a sale.

## Tickets on paper

Two printers, two different documents, two different ways of reaching them.

The counter receipt prints from the browser. It is the same document that goes
in the email — built once, so a printed ticket cannot disagree with an emailed
one — wrapped at print time in an 80mm page with the screen's greys pushed to
black, because a thermal head has no grey. Any printer the counter machine can
see works: USB, Ethernet, AirPrint. Chrome started with `--kiosk-printing`
prints it with no dialog at all, which is what a counter actually wants.

The kitchen printer is polled, not pushed. Nobody stands at it to press print,
and reaching into a restaurant's network to talk to it is not a shape we will
build. So the printer asks us: a CloudPRNT printer POSTs to its own URL every
few seconds, we answer whether anything is waiting, it GETs the ticket and
DELETEs to confirm. Outbound HTTPS only — no port forwarding, no static IP, no
agent installed on anybody's machine.

That URL is the printer's whole credential; it cannot log in. So it is 32
random bytes, it is in no column grant, only an owner or manager can mint one,
and minting a new one revokes the old. Automatic printing is off until somebody
turns it on, and a wrong URL is told the same "nothing waiting" a quiet counter
hears.

A kitchen ticket is not a receipt. It carries no money at all: a cook does not
need the total and should not read it off the paper while food is waiting. What
it carries loudly is what to make, how many, and what somebody asked to be
different about it.

Queuing is a database trigger, not a line in each route. An order reaches the
pass from several directions — a diner paying online, a table ordering to
settle later, a cashier ringing a sale — and the row itself decides: the moment
an order becomes `received`, a ticket is queued, once. A path added later is
covered without anybody having to remember this exists.

## Some products never reach the kitchen

A bottled drink, a packaged snack, a bag of beans: `skips_kitchen` on the menu
row means the dish needs no preparation. Those lines stay off the kitchen
ticket — listed below the rule as handed over, so the runner still knows what
was in the bag, but not among the things a cook has to make.

At the counter it means more than that. A sale of nothing but shelf items was
put in the customer's hand as it was rung up, so it is created `completed`: no
ticket, nothing on the pass, no name to call out. One prepared line is enough to
make it an ordinary order again.

Only at the counter. The flag means "needs no preparation", and the counter is
the one place where that also means already delivered — a bottled water ordered
from table 6 still has to be carried to table 6, so a QR order is unchanged.

## The customer can decline the ticket

Very common on a sale handed over as it is rung up. The cashier ticks one box
and nothing is printed and nothing is emailed — not built and quietly dropped,
but never built, so no address goes anywhere near the request. The sale is
recorded exactly as any other: declining the ticket does not decline the
accounting, and the restaurant's obligation to issue a fiscal receipt to
anybody who asks is unchanged.

## The waiter takes the order

The oldest act in the trade, and the one thing the app could not do: somebody
walks to a table and writes down what the people sitting at it want. Everything
around it already existed — the bill, the split, the discount that needs a
manager, taking cash at the table — and none of it was reachable, because an
order had to start on a diner's phone. A restaurant that runs on waiters needed
a second system for the first step, and given the choice between two systems and
one, nobody picks two.

`/dashboard/table-order` is the waiter's pad. The same menu the till shows,
sold-out dishes included and marked, taken through the same dish screen a diner
uses — the modifiers, the extras, this item's own special request — because a
waiter is writing down the same order, and asking it a second way is how one
dish ends up with "less onion" and another in the same round has nowhere to say
"extra onion".

It sends the order to the kitchen **owing**. Nothing is charged: the table
settles at the end, which is what the bill screen has always been for. Two
orders at one table join one sitting, so what the diners see on the bill is
what they ate together.

The table must already exist. A waiter picks it and never invents one, so every
order can be found afterwards by the label the restaurant already uses — on the
board, on the bill, and in the history search.

On `servicio` and above. Deliberately the entry paid tier rather than higher:
`servicio` is the tier named for service and already carries dine-in and
settling at the end, and `carta` has no tables at all.

## Paper for an order that already exists

The order dialog prints, and the same dialog opens from the board and from the
history — so a ticket can be asked for whatever column the order is in, and long
after it was served.

Two different pieces of paper. **In the kitchen** puts it back on the
restaurant's printer, for a ticket that jammed or one the pass never saw because
the printer was off when it was placed. **The ticket** is the customer's
receipt, printed through the browser — the same document the till prints and the
same one an email carries, so a reprint cannot say something different from the
original.

Asking again is not the same as asking twice by accident. `print_jobs_once` is
unique on `(order_id, kind)` precisely so a repeated trigger cannot put one
ticket on the paper twice, which means a reprint cannot insert a second row: it
re-arms the existing one, unclaimed and unprinted, back in the queue.

A restaurant with no printer address is told so rather than having a job queued
for a machine that will never ask for it.

## A name is a way to find an order

The history searches the code, the table, and now the name a diner gave at the
counter — the three things anybody remembers about an order and the only ones
the person searching can see.

The term is quoted before it reaches PostgREST. `or()` takes ONE raw filter
string and splits it on commas, so a diner called "Perez, Juan" would not merely
fail to be found: the half after the comma would be read as another condition,
and anything shaped like `x,customer_name.not.is.null` would be a filter
somebody typed into a search box.

## The connection is a requirement

TableTap runs online, and the terms say so rather than implying it. Without a
connection the dashboard, the till and the diner's menu are all unavailable,
and nothing — an order, a charge, a corte — is recorded until it returns. The
restaurant is responsible for that connection in its own premises.

The kitchen board is the one exception, and deliberately so: it keeps showing
the tickets it already had, because losing sight of what is cooking is worse
than the alternative. Everything else refuses rather than pretending.

## Losing the connection

The kitchen board keeps working when the wifi does not. A service worker holds
the last board that loaded and serves it when the network does not answer, and
a banner says the screen is reading history rather than the kitchen.

**One page is cached, deliberately.** The board carries tickets. A stale bills
screen showing a paid table as still owing is how the same money gets collected
twice, so nothing under `/dashboard/bills`, and no API response at all, is ever
stored. The cache holds a signed-in page, so signing out empties it — most
restaurant tablets are shared.

**Status moves are held; money is refused.** A move made on a dead connection
is kept and sent when the connection returns, folded so three taps on one
ticket are one change. Settling, cancelling and approving refuse offline and
say why: replaying them charges a table twice. Each held move carries the
status it began at, and the server applies it only if nothing has happened
since — stale work never overwrites live work.

Available on every plan.

## Stack

Next.js 15 (App Router) · Supabase (Postgres, Auth, Realtime, RLS) · Stripe
Connect · TypeScript · pnpm · Node 22. Deployed on Vercel. Email/password auth
for staff, invitations for the team.

## Still open

Not code — the things only the business can do: registering the two Stripe
webhook endpoints, live Stripe keys, a published contact address for privacy
requests, razón social / RFC / domicilio, a lawyer's read of the legal text, and
a mail provider for receipts and staff invitations.

`docs/before-launch.md` is the checked list, with what each one breaks while it
is missing and how to prove it works once it is done.
