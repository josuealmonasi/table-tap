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
| **Waiter** | orders + open bills + the pad | take the order, carry it out, collect in parts, ask for a discount or a write-off |
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
the till. Then the money path is one of four: `/api/bill/pay` for the diner's
card, `/api/split/pay` for one share of a divided bill, `/api/table-payment`
for a waiter settling the whole table, and `/api/table-payment/part` for the
calculator taking a piece of it.

## Order status

```
pending_payment ──(webhook: paid)──▶ received ──▶ preparing ──▶ ready ──▶ completed
                                          └──────────────────────────▶ cancelled
```

`pending_payment` never reaches the board. An order that is delivered before it
is paid rides the same track and carries its debt on the bills screen instead.

A write-off is not a third terminal state: it forces the order to `completed`
from wherever the kitchen left it, and leaves an already-`cancelled` row alone.
`/api/order-status` carries `written_off`, and the diner's tracker treats it as
finished whatever the stage says — it stops polling for a change nobody is going
to make, withdraws the "follow your order" button, and does not ask them to rate
dishes on a bill the restaurant has just cancelled.

## Money

- **Stripe Connect, direct charges.** The restaurant's account takes the payment;
  we take an `application_fee_amount`. It used to be a destination charge on our
  platform, which had Stripe billing *us* for every order.
- **Plans** (`plan_limits`): `carta` free, `servicio`, `casa`, `grupo`. Each row
  carries the ceilings (tables, staff, menus, items) and the feature flags:
  dine-in, menu schedules, deferred payment, promotions, coupons, staff
  discounts, inventory, the counter till, waiter service.
  `can(limits, feature)` is the only way to ask.
- **Founding price**: the first restaurants on a paid tier keep the price they
  came in at. `claim_founding_price` serialises the assignment with an advisory
  lock so two simultaneous subscribers cannot take the same place.
- **Coupons and promotions** are reserved and released like stock, for the same
  reason: a code with two uses left must not be spent three times.
- **Discounts and write-offs** are requests a waiter raises and a manager
  approves — `discount_requests`, `write_off_requests` — so the person who gives
  money away is never the person who asks. A write-off also FINISHES the orders
  it cancels: `completed`, not `cancelled`, because the food went out and the
  kitchen spent it — that is the whole reason it is a write-off and not a
  refund, and `/api/orders/cancel` is the only path allowed to set `cancelled`
  because that one refunds the card first. Without it the ledger was right and
  every screen showing live work was wrong: the pass kept tickets for a table
  that had gone, and the diner's phone kept offering to follow an order on a
  table the floor had cleared for the next party.
- **A table can divide its bill evenly**, where the restaurant leaves the
  switch on. `restaurants.split_enabled` defaults to true and either the owner
  or a manager can turn it off from Settings — a bar running one tab, a set
  menu, anywhere the floor would rather do the arithmetic itself. It gates the
  *offer* and nothing else: `/api/split` never reads it, which is a deliberate
  exception to this document's own rule that a screen hiding a button is not a
  guard. Nothing is at risk if somebody posts past it, because what a share
  costs is summed from the orders either way.
- **Only between the people who are actually eating.** The ceiling is the
  number of DEVICES that have ordered on the table — `orders.diner`, counted by
  `diningOn` — never the number of chairs, and never more than 20, which is
  what the `shares` column allows. Orders a waiter typed in carry no device and
  count as one party between them rather than one each. Under two devices the
  offer is not made at all: not a disabled control, not an explanation,
  nothing. `/api/split` refuses `party < 2` or `shares > party` with 409
  independently, because a dropdown is not a guard. One diner alone was offered
  a split between 2 and 20, chose twelve, and could not pay at all until the
  proposal was called off: eleven of those shares belonged to nobody, and a
  share nobody claims freezes the bill for everybody.
- **Dividing it does not need a card reader.** With Stripe connected the
  proposal goes round the table and each share is charged to its own phone.
  Without it there is no proposing and no freezing — just "MX$34.10 cada uno",
  the division the table shows the waiter, who collects each share on the
  calculator. That is most of what a table actually does with a bill, and the
  card gate belongs on *paying*, not on *dividing*.
- **It freezes when the agreed number of seats is claimed** — which can be
  fewer than the people at the table. Three phones order, two of them halve it,
  and it locks with the third outside; that phone is told its food is inside
  those shares and there is nothing for it to pay. The table divides what it
  owed at that instant, the odd cent goes to whoever asked (MX$10 between three
  is 3.34 / 3.33 / 3.33), and anything ordered afterwards belongs to whoever
  ordered it. Freezing is what lets a table keep ordering while the others are
  paying, which is money that would otherwise be turned away. A proposal nobody
  finishes expires after 30 minutes and the next read cancels it, so one person
  in the bathroom cannot leave the rest unable to pay; any diner may call a
  proposal off, and nobody may once it has frozen.
- **A frozen split closes the other doors to the same money.** `/api/bill/pay`
  answers 409 while any sitting behind the table's unpaid orders holds a locked
  split, and `/api/bill` returns `dividing` so that even a phone which scanned
  without ordering — and therefore knows no sitting — learns of it and puts its
  own card button away. A phone that ordered and took no share could otherwise
  pay for the lot while the halves were being collected: one dinner, charged
  twice.
- **And it ends the moment the money arrives another way.** `endSplitsFor`
  closes every proposal or lock on a sitting when that sitting closes — paid,
  settled or written off — and on every sitting a waiter's part-collection was
  spread across. A share is the figure frozen at the lock and knows nothing of
  what happened since: MX$200 halved, MX$120 taken in cash at the table, and
  both halves still chargeable is MX$320 collected for a MX$200 dinner. Ended
  rather than recalculated, because the diners agreed to divide *this* bill and
  a different number is not what they agreed to. `/api/split/pay` refuses as
  well once the sitting owes nothing.
- **What is divided is the orders' totals.** An order's total is subtotal plus
  service charge plus any tip committed when it was ordered, so a gratuity a
  diner has already chosen is inside the pot the table splits. "The tip is each
  person's own" is true of the one added when a share is *paid*: clamped to the
  payable amount, recorded in `payments.tip`, and added to the oldest order on
  the sitting.
- **Our fee on a divided bill is the table's, not each person's.** It is
  computed only when no share has yet been paid and rides on the first one, the
  same way settling a whole table puts it on the first order. Charging it per
  person would be a fee for the courtesy of splitting.
- A share is money against the *sitting* rather than any order, so the floor's
  bill screen says how much of it is already in — a waiter taking cash for a
  table that has half-paid by card is how the same money gets collected twice.
  A waiter collecting the bill in parts puts money there the same way, and the
  board reads both from the ledger rather than from the split's own claims.
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
- **Stripe's limits are hard, and an ordinary busy table reaches them.** Three
  of them, each one refusing the whole request rather than degrading: a
  metadata value stops at 500 characters, which is fourteen order ids, so the
  list of orders a payment settles is written across as many keys as it needs
  (`packOrderIds`, first key keeping its old name so sessions created before
  that shipped still settle); Checkout takes 100 line items and the diner's
  cart makes one per line plus the service charge and the tip, so the card
  path caps the cart at 98 where the waiter's and the till's cap at 200; and a
  product name stops at 250, which a dish name written straight from the
  browser under RLS can exceed. Every one of them failed the same way — the
  API rejects it, the route's catch says "checkout failed", and tapping again
  does the same thing. No money was ever at risk; the bill simply could not be
  paid by card.
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
Thirty tables, RLS on every one of them, in groups:

- **The restaurant** — `restaurants`, `staff`, `profiles`, `platform_admins`,
  `plan_limits`, `user_logs`
- **The menu** — `menus`, `categories`, `menu_items`, `item_addons`,
  `dietary_tags`, `icon_groups`, `icon_group_items`
- **Selling** — `orders`, `payments`, `table_sessions`, `restaurant_tables`,
  `service_requests`, `dish_ratings`, `bill_splits`, `bill_split_claims`
- **Paper** — `print_jobs`
- **Offers** — `promotions`, `promotion_items`, `coupons`, `coupon_redemptions`
- **Money asked for** — `discount_requests`, `write_off_requests`
- **Telling people** — `notifications`
- **Keeping the door shut** — `rate_limits`

`orders` snapshots its line items as JSON at purchase time, so a menu edited
tomorrow never rewrites what someone bought today.

`orders.diner` is the throwaway token a phone gives itself for the evening —
localStorage, per restaurant, bounded to 64 characters and rejected rather than
truncated past that. It names a device and nothing else: no account, no person,
nothing that outlives the meal. `/api/checkout` is its only writer, so an order
the waiter's pad or the till typed in has none, and that is what makes them the
single anonymous party when a table is divided. It is also the only identity
anybody has at a table, which is what lets it hold a seat in a split.

## Security

Assume the browser is hostile; it holds the publishable key and nothing else.

- **RLS on every table**, and a policy is not optional: a table with RLS and no
  policy denies everything, which is how `platform_admins` is protected. Team
  membership is not always the line, either — `payments` is read by
  `has_role(restaurant_id, ['manager','waiter','cashier'])` rather than
  `works_at`, so the kitchen cannot read the night's takings or see what each
  person took.
- **Column grants, not just row policies.** `restaurants` is publicly readable
  by row — the menu hangs off a QR — so what is granted is an allowlist of the
  PUBLIC columns, identical for `anon` and for `authenticated`. The private
  ones (owner, plan and billing state, Stripe account and customer, the print
  token) are in no grant at all; they are read with the service key. The order
  matters and the script says so: the `revoke select ... from authenticated`
  comes FIRST, because granting columns does not remove a table-wide grant
  already held, and a row policy alone had leaked the lot to any signed-in
  account.
- **Writes that matter are server-only**, with the secret key, always scoped by
  the caller's restaurant. PostgREST returns no error when RLS filters a write to
  zero rows, so the routes check what actually changed.
- **`security definer` functions** — seventeen of them — all pin `search_path`,
  and Postgres grants EXECUTE to PUBLIC by default, so every one is revoked
  explicitly first. Most are then `service_role` alone: `reserve_stock`,
  `release_stock`, `redeem_coupon`, `rate_limit_hit`, `claim_founding_price`,
  `open_table_session`, `close_session_if_clear`, `join_bill_split`. Four are
  deliberately granted to `anon` and `authenticated` — `owns_restaurant`,
  `works_at`, `has_role` and `dish_rating_stats` — because the RLS policies
  themselves call them, and a policy that cannot execute its own predicate
  denies everybody.
- **Capability tokens**: an order id is unguessable, and that is what lets a diner
  track without an account. Public routes that take one are rate-limited.
- **No secret can reach a client component** — an invariant walks the real import
  graph, counting only imports that survive compilation.
- **Realtime is the other door out of the database**, and the spec was silent on
  it for a long time. Three tables are published: `orders`, `service_requests`
  and `menu_items`. RLS applies on the socket exactly as it does on a read,
  which is the whole reason the tills may subscribe to stock while the diner's
  menu cannot — a staff read of `menu_items` is `works_at`, which does not move
  when the stock does, while the diner's is `available AND menu active`, so a
  dish selling out takes the row out of their reach and suppresses the very
  event they would want. What realtime does NOT filter is columns: the payload
  carries the whole row, so a table is only publishable when its row policy
  alone is enough. `pnpm rls` asks the socket the same questions it asks
  PostgREST.
- **One public storage bucket**, `menu`. Reads are public by policy because the
  pictures hang off a QR poster; writes are manager-scoped by path, the first
  segment of the object name being the restaurant id that `storage_restaurant()`
  reads back. The bucket itself is bounded — 5 MB, `image/webp` only — and that
  bound is the Storage API's, not RLS's, so it holds against the service key
  too.

## What exists

Diner: menu with categories, search, dietary filters, combos and offers, item
modifiers and extras, cart, coupons, tips, card payment, pay-at-the-end,
pay-at-the-counter, dividing the bill with the rest of the table, live tracker
with a QR staff can scan, receipts by email, dish ratings, ES/EN.

Restaurant: multiple menus with schedules, full menu editing, dietary tags and
icon groups, tables with printable QR codes, the orders board, open bills,
discounts and write-offs with approval, promotions and coupons, inventory with
low-stock alerts and live counts on the selling screens, analytics, corte de
caja, staff and roles, plan and billing, Stripe onboarding, activity log,
notifications bell, and the switches that decide what the diner is offered —
taking orders, pay-at-the-end, dividing the bill.

Platform: sign-up, plans, founding prices, the admin console, legal documents
generated as PDFs from the same source the app renders.

## How it is kept honest

The gate, all of which must pass before anything ships:

| command | what it proves |
| --- | --- |
| `pnpm test` | the pure logic, and the invariants that span files |
| `pnpm api` | all 48 routes answer a legitimate request correctly |
| `pnpm rls` | nothing is exposed, by read or by socket, as every role |
| `pnpm roles` | each role reaches its own screens and no others |
| `pnpm smoke` | every page renders |
| `pnpm layout` | every screen reads at 390 / 820 / 1280 |
| `pnpm promises` | no screen offers what the system will refuse |
| `pnpm attack` | nobody signed in can move a peso they should not |
| `pnpm dialogs` | every dialog, found by opening it rather than by listing it |
| `pnpm money` | the ledger and the orders tell the same story |

The table left `attack` out for a while and the prose below listed it, which is
the same drift this document exists to prevent. `pnpm api` does not police its
own list either — the invariant that fails when a route has no case lives in
`pnpm test`.

Two rules behind them, both learned the hard way. **A check only covers what is
on its list** — invariants now fail when a route or screen exists that nothing
checks. And **static guesses lie**: when the question is what a person actually
gets, measure it in a browser. `pnpm promises` learned the second one late: it
swept whole pages for months without ever opening a DIALOG, which is where the
bill lives, and three of its nine states now press a button first.

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

**The tiles say how many are left**, on the till and on the waiter's pad alike
— the two screens share the tag, the subscription and the sentence line for
line. Only for the dishes that are counted: `stock` is null for most of them
and a tag on those is a number nobody can act on, and a sold-out tile keeps its
badge instead. It is a reading, not a promise — between seeing it and pressing
it somebody else can take the last one, and `reserve_stock` is what settles
that. Nothing trusts the number, which is what makes showing it safe.
`useLiveStock` keeps it close: the same subscription shape as the orders board,
pointed at `menu_items`, about two seconds from the shelf moving to the tile
moving, and a refresh whenever the tab comes back into view.

And the refusal names the figures, not just the dishes: "No alcanza: Calamari
(sólo quedan 4); Ribeye (ya no queda)". `reserve_stock` has always returned how
many are really left and both staff screens threw it away, so the answer to
"how many can I have then?" was a walk to the kitchen. Zero gets its own words,
because "ya no queda" is not "quedan 0". The diner's checkout already named its
count, and still trims the cart to what is left rather than only saying so.

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

**The till can also scan what the customer is holding.** Somebody who ordered
from their phone arrives at the counter with a code that says, in our own words,
that the counter scans it and charges it — and until recently the caja could
not, so the cashier left the till, opened Cuentas abiertas and searched, with a
person waiting. The same camera and the same reader now sit in the till's
header, and Cuentas abiertas keeps its own: the list serves somebody who reads
out their name, the camera serves the queue. It collects nowhere near the till.
The code names a bill and the bill is settled on the screen that settles bills,
through `/dashboard/bills?order=<id>` — one way for money to be taken, not a
second one that has to agree with it.

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

`/dashboard/table-order` is the waiter's pad. The same menu the till shows —
sold-out dishes included and marked, the counts on the tiles and the refusal
that names them exactly as the counter has them — taken through the same dish
screen a diner uses — the modifiers, the extras, this item's own special request — because a
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

**Or they scan it.** A waiter in their first week has not learned thirty table
names, and the one the app calls "Patio 3" may have nothing on it saying so —
scanning the code stuck to the table is how they say "this table" without
knowing what anybody calls it. The list is still there and still works. A code
from another venue decodes perfectly well, so the restaurant comes back with
the table and is checked before anything is selected; the route refuses it as
well.

On `servicio` and above. Deliberately the entry paid tier rather than higher:
`servicio` is the tier named for service and already carries dine-in and
settling at the end, and `carta` has no tables at all.

## The waiter collects

A table of three where one pays MX$100 and the others MX$50 each is an ordinary
Tuesday here, and the app could do neither: it took the whole bill at once, or
froze it into equal shares the diners claimed on their own phones. The waiter's
calculator is the other thing — a running balance, standing at the table.

**All of it, equal parts, or a figure somebody names.** Equal parts reuse
`sharesFor`, the app's one way of dividing a bill, so the odd centavo lands on
the first share exactly as it does when the diners divide it themselves. The
waiter can take any amount; the parts are the numbers the screen offers so
nobody does long division at a table.

**The balance is one sentence:** what the orders come to, less what has been
paid against them. A gratuity is added to the order as it is collected — the
attribution settling a whole table already used — so it appears on both sides
of that subtraction and never moves it. The bill closes when the balance reaches
zero, and only then are the orders marked paid.

That subtraction is done per SITTING and the table's figure is the sum, rather
than a second calculation that can disagree with it. A table can owe on more
than one — an old sitting expires with something still on it and the next party
opens another — and a sitting that had already closed one bill read as owing
nothing on the next, so a collection for it was recorded nowhere at all. Orders
old enough to predate sittings have none, and while NO unpaid order has one the
old single subtraction is what happens. Which sittings a table owes on never
leaves the server: the calculator is handed the arithmetic and not the ids,
because attribution is not something a screen has any use for.

An early version counted the food by taking `tip` back off `total`. It cancelled
the tips it had just added, and also cancelled a tip a diner had committed to
when ordering and nobody had collected: a table owing MX$94.07 read as MX$93.17.

**Every collection is recorded as it is taken**, against the sitting rather than
any one order — the money belongs to the table, and pinning it to a dish would
say that dish was paid for. `payments.tip` says how much of each was a gratuity,
which is what lets a corte separate the food from the tips. When a collection
covers more than one sitting it is shared out oldest first, the remainder
landing on the first, and the gratuity rides with that first share. Settling a
whole table is the other shape: on an untouched table it writes one row per
order carrying its `order_id`, and only shares out against sittings when
something had already been collected.

**A tap is not a payment; a collection is.** `payments.client_ref` is unique per
restaurant: the phone names each collection and reuses that name on every retry,
so a button tapped twice on a bad signal lands in the ledger once. Without it a
second MX$100 reads as a bill covered while the table walks out still owing.

**Settling in full subtracts what was already collected.** Otherwise the orders
are recorded at their full totals and money that arrived once is counted twice.
The bills board says how much is already in on any part-paid table, read from
the ledger — which covers a divided bill and a waiter's collection alike.

A promotion still goes to whoever may grant one. The waiter asks from the
calculator instead of leaving the table.

## A bill the waiter opened is settled with the waiter

`table_sessions.opened_by` records who opened a sitting, and only when the call
creates one: a waiter bringing a round to a table that opened its own bill has
not taken it off them.

The diners keep everything except the card. They see what has been ordered, they
add to it, and the bill screen says who is collecting and offers to call them.
The coupon box and the tip chips go with the card button, because neither
changes a number the waiter's calculator will use, and dividing it goes too —
the waiter has a calculator that does the same job. `/api/bill/pay`,
`/api/split` and `/api/split/pay` refuse — a screen that hides a button is not
a guard.

There are three reasons the card button may be missing, and the screen says
which: the restaurant takes no cards, a waiter opened this bill, or the table
is dividing it. Two of them are decided by `billActions`; the third is the
locked split, which the screen learns from `/api/bill` rather than from
`/api/split`, because that one answers about a sitting and a phone that scanned
without ordering has none. Whichever it is, calling somebody over survives —
that needs nothing but a floor. Hiding it along with the card left a phone
looking at a bill with nothing on the screen to press at all, which is a worse
failure than the button it was hiding.

Two people collecting the same bill through different doors is how a table pays
twice.

## The floor is told when the food is ready

The board's two jobs meet at `ready`: the end of the kitchen's and the start of
the floor's. Nothing said so, and a waiter had to keep glancing at a screen
across the room while a plate sat under a lamp.

Ready food sits in the same bar as a raised hand, **one chip per trip** rather
than per ticket and longest wait first — a waiter walks to a table, and three
dishes for table four is one journey. Handing them over closes every ticket on
that trip through the board's own move, so it queues offline like any other.

**Waiters only see the chips.** The pass put that food there, so a chip telling
the kitchen their own plate is ready is one they learn to ignore — and then
they read past the table asking for a waiter two chips down. The same is true
of anyone else not carrying plates. Everybody still has the Ready column and
its Complete button; what is waiter-only is the queue of journeys.

No new column and no new kind of notification: `ready` already meant this, and
the bar was already how the floor is told something is waiting.

The nav badge follows the rule its own file states — count people only on what
they can act on. The kitchen is counted on what is still to cook, the floor on
what is waiting to go out, and whoever covers both jobs on both.

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

## What the browser is allowed to do

A real Content-Security-Policy, written against what the app actually fetches.
The shape of the app made a strict one affordable: scripts are Next's own from
our origin, `next/font` self-hosts the faces, Stripe Checkout is a full-page
redirect rather than an embedded frame — `@stripe/stripe-js` is never imported
— and the only other host the browser talks to is Supabase.

So it is nonce-based, which means it is written in the middleware rather than
in `next.config.ts`: a nonce that is not new on every request is a password an
attacker can read off the page. Setting it on the REQUEST is what lets Next
stamp the same value on its own bootstrap; setting it on the response is what
makes the browser enforce it. `'strict-dynamic'` then trusts that script and
what it loads, and nothing else. No inline script is allowed anywhere; inline
STYLE is, and has to be, because the app styles elements with React's `style`
attribute and a nonce cannot apply to an attribute.

The directive that earns the most is `connect-src`. A script that somehow ran
can reach us and our database and nowhere else — so it has no address to send
anybody's bill to. `base-uri 'none'` is the quiet one: a `<base>` somebody
injected rewrites every relative URL on the page, including the ones that post
money.

**Two things it broke, both worth having found.** The print windows said
`<body onload="window.print()">`, which is an inline handler — the opener does
it now, waiting for the same moment, because printing before the stylesheet
applies puts an 80mm ticket on a Letter page. And `Permissions-Policy` said
`camera=()`, an EMPTY list, which refuses our own page as well: the
scan-to-collect button shipped and could never open a lens. It is `(self)`.

## What is checked, and how

`pnpm test` `api` `rls` `roles` `smoke` `layout` `promises` `money` `attack`,
plus `dialogs` when a dialog, a shared component or the stylesheet moves.

The two that guard the money are `money` and `attack`. `money` reconciles the
ledger against `orders.paid` — two records of one fact, which is the shape of
every bug this app has had — and now fails in both directions: a sitting with
less money against it than it owed, and a sitting with more, which is the one
that flatters the takings and nothing checked before.

`attack` asks what somebody who IS signed in can do that they should not, and
judges every case on EFFECT rather than on the absence of an error: the ledger
is counted before and after with the secret key. A write RLS filters to zero
rows returns no error at all, and reading that as "allowed" once reported four
tables as wide open that were all fine.

Every check plants what it needs rather than depending on what the demo data
happens to hold, and removes it afterwards. A check that finds nothing to
attack passes without asking anything — the RLS sweep did exactly that on twelve
of twenty-one tables — and test litter comes back later disguised as a product
bug. Two money cases were written, passed on the day, and were asking nothing:
no restaurant in the development database has a Stripe account, so the routes
they probed refused them at the door long before the question they existed to
ask. Before believing a green check, ask what the FIRST refusal on that path is
and whether the case gets past it.

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
