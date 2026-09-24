# Shipping a big change without breaking something

Every bug we have shipped in this codebase has been the same shape: **two
places that had to agree, and nothing checking that they did.** None of them
were type errors. The code compiled perfectly while the staff screen said a
table owed MX$105 and the diner's screen said it owed nothing.

So this is not a style guide. It is the list of things that have actually bitten
us, and what now catches each one.

## What runs on its own

`src/lib/__tests__/invariants.spec.ts` enforces the rules that span files:

| Rule | The bug it came from |
|---|---|
| A table created after the blanket `revoke … from anon` locks itself down | `rate_limits` shipped world-readable |
| No dialog is rendered inside another dialog | Shipped three times — two focus traps, two Escapes to leave |
| Anything marking an order paid or written off closes the sitting | A sitting that never closes holds the table and the diner forever |
| Every API route has a guard or a rate limit | `order-status` was public and unlimited from the day it was written |
| Nobody hands `paymentOptions` a hardcoded `atTable` | The cart passed `true` always, so paying at the till could never be offered |
| No route parses a request body by hand | Malformed JSON reached a money route as an exception and came back a 500 |
| A refusal always carries a sentence, and every `CartRejection` has one | `/api/table-order` answered `{ rejection }`, which the waiter's screen read as "network error" |
| Stripe payloads stay inside Stripe's limits | A table of fourteen could not pay by card: `settle_order_ids` passed 500 characters |
| No screen offers a refund the till cannot give | A cash sale offered "Cancelar y reembolsar" and the route refused it for ever |
| One function builds the code printed on a ticket | `orderCode` and `shortCode` agreed only because every id is a uuid |
| Every i18n key written as a literal resolves | `translate` returns the key itself on a miss, and TypeScript never sees the string |
| A restaurant row is never created on a trial with no end | The admin screen opened accounts on a trial `getPlan` could never settle |
| A cancelled sale leaves the drawer of whoever took it, once | The corte counted an honest waiter MX$100 short for handing a cancelled cash sale back |
| Every sign-in a gate makes has its error read | A failed sign-in turned nine of a manager's screens into oks nobody had seen |
| The cancel dialog words its offer from the plan the cancel follows | A POS card sale, a table settled by card, and a table's online bill could never be cancelled — "still settling", for ever |
| The live board is seeded by status, with no row limit | An order the kitchen had not started fell off the board after 100 newer ones, while the badge still counted it |
| A sweep that clicks everything changes nothing | One `pnpm dialogs` run completed every live order, duplicated dishes and approved a write-off |
| Every seed accepts the terms the app enforces | A hand-kept copy of the version fell a month behind, and every seeded account opened on the terms modal |
| A state that is not a dialog can still be measured | Renaming a menu at 390px made the page scroll sideways, and neither sweep could see it |
| `schema.sql` builds an empty database, top to bottom | A revoke above the table it named broke every reset from nothing for two weeks, unseen |
| The demo seed never collides with its own kitchen trigger | `db:mock` failed half-built whenever the newest random order was still at the pass |
| A grid column can shrink below its content | A month's takings pushed Analytics' tiles 21px off a phone, and the skeleton was a fixed guess |
| A date is written in the reader's language, not the machine's | Every Spanish owner's chart said "25 Tue": `Intl.DateTimeFormat([])` answered in the host's English |
| The fault that matters most is never cut from layout's list | Thirty squashed chart labels filled the list's twelve places, and "the page scrolls sideways" was cut off |
| A date on screen is in the app's language, not the browser's | A Spanish owner on an English phone read English dates and times on eight screens |
| A gate waits for what it checks, not for a number of milliseconds | "free plan · promotions" failed on a slow compile and passed on the rerun |
| Seeded visits are dated by the restaurant's calendar, never today | The demo's seed filled today's slot after 6 p.m. in Mexico City, and a first scan said "already stamped" |
| Both browser sweeps open a 360px phone | The menu editor's product row spilled 28px past its box at 360 and ran off a 320px phone; Analytics broke "Cheesecake" in half. 390 read clean |
| A failed read is never an answer | One refused bill poll told a diner who owed that they had paid; the waiter was told the table owed nothing; a phone forgot the table it owed at; the badges said nobody was calling |
| A tip is added once, and the ledger records it | Every repeated delivery of a whole-table card payment raised the order's tip and total again; the payment row left the tip out |
| A polled route is sized for the room behind one address | The tracker's 120 a minute was thirty diners on the menu; one table of six dividing its bill ran out the split's 60 |
| A request that says it worked reads its answer | "Llamar al mesero" said "¡En camino!" for a minute whatever came back, a refusal or no connection |
| A refused move is not a dropped connection | A 403 from an expired sign-in was held as "saved, will be sent" and retried on every reconnect |
| An order that could not be read is not a missing one | A failed read of an order was null, and the tracker answered a diner who had just ordered with "not found" |
| A screen money is counted on reads or refuses | A failed read on the bills board showed no open tables, or nothing already collected, so the whole bill looked owing again |

`src/lib/__tests__/schema-drop.spec.ts` keeps `drop.sql` in step with
`schema.sql` — every table, every function, every storage policy. Eight tables
had drifted, which is why `db:reset` failed on production.

`src/lib/__tests__/i18n-parity.spec.ts` keeps both catalogues complete.

`src/lib/__tests__/security-headers.spec.ts` holds a version floor for Next
**and** for sharp. The sharp one reads `pnpm-workspace.yaml`, because pnpm 11
ignores `pnpm.overrides` in `package.json` and says so only in a warning.

`src/lib/__tests__/stripe-limits.spec.ts` pins the three Stripe ceilings a busy
table reaches — 500 characters per metadata value, 100 line items, 250
characters per product name — and proves the old single-key metadata really did
overflow, so the rest of the file cannot pass on a broken version.

`pnpm smoke` signs in for real and loads **every** dashboard page plus a
customer menu, failing on an error boundary, a bounce to login, or a page with
no content. `pnpm smoke:prod` does the same against the deployed site. Written
after three separate "it works" claims that were each checked one page at a
time while a neighbouring page was blank.

`pnpm prod:check` compares dev and production schemas, loads a real customer
menu, and confirms every documented login resolves to a restaurant **in both
environments**. Run it after every merge.

## What still needs a person

These have all cost us a round trip. None are automatable yet.

**A long-lived dev server lies.** After dozens of merges it will serve a stale
compile of one page beside a fresh build of another — a page that sends the old
set of props to a component that now requires new ones, which throws at
hydration and white-screens. It looks exactly like a code bug and is not one.
If a page breaks and the source looks right, `rm -rf .next` and restart before
debugging anything. `pnpm smoke` against a freshly started server is the only
verification that means anything.

**Read the exit code, never the tail.**
`pnpm money 2>&1 | tail -2` hands back tail's status, not the gate's. For part of
one night `pnpm money` was failing and was reported green every time, because
the last two lines of a failing run look like noise to somebody hunting for the
word "agree". Run each gate to a log and print `$?`; open the log only when it
is not zero. Grepping for the success string is the same mistake — a crash and
a pass both lack a failure line.

**A check nobody has watched go red is not a check.**
Break the thing it guards, run it, see it fail with a reason, put it back.
This audit found the harness passing for the wrong reason over and over: the
layout gate reached 33 of 228 paths and hung on the rest; `pnpm dialogs` printed
`ok` when its audit threw; three `/api/split/pay` cases passed on "this
restaurant cannot take cards", which is also a 409; an invariant was satisfied
by the comment explaining the fix. Every one of them was green. None of them
had been seen to fail.

**The seed decides what can be tested.**
A restaurant flag left at its default removes a whole feature from every gate,
and the gates still print `ok`. `/api/checkout` refused every probe at the door
because no seeded restaurant had Stripe or pay-later; the CloudPRNT endpoint had
no case at all because no printer was seeded; 65% of `/api/split/pay` had never
run. When a probe returns the same refusal for different inputs, the inputs
never reached the logic. `arrange` in the api gate lends a card reader for one
case; the seed now enables pay-later and a printer.

**Look at it. In a browser. Actually rendered.**
Measuring is not looking. The menus dropdown reported a sensible rectangle from
`getBoundingClientRect` and was never once painted — an `overflow-x` ancestor
was clipping it. It shipped, and the only reason we found out is that somebody
hovered it. When a screenshot cannot be captured, `document.elementFromPoint`
at the element's own centre tells you whether it is really on screen.

**When a rule applies to money, apply it to every path or none.**
The bill window went onto the diner's read and the staff read, but the staff
screens kept their own unwindowed query — three contradictions from one change.
Before shipping a rule about what a bill contains, list every route that reads
or writes orders and say out loud which side of the rule each one is on.

**Both databases, every time.**
Dev is not a scratch pad. Resetting dev and re-seeding only production left
`demo@tabletap.dev` with no restaurant, and the next person to sign in lost a
morning to a bug that was not in the code. `pnpm prod:check` now covers both.

**A record that ends a bill has to end the work too.**
Cancelling what a table owed set `written_off` and stopped there, leaving every
order at `received`. The ledger was right and every screen that shows live work
was wrong: the kitchen still had tickets for a table that had gone, and the
diner's phone still offered "follow your order ORD-09BB" three times over on a
table the floor had cleared for the next party. `pnpm api` now writes a table
off and reads the orders back, and fails if any of them is still on the board.
When a flag means "this is over", find every screen that asks "is this still
happening" and make sure it is asking the same question.

**A fixture that picks a row by sorting picks a different row every reseed.**
`pnpm api` chose the alphabetically-first available dish to order with. After a
reseed that dish was on the demo's "Weekend Brunch" menu, which serves Saturday
and Sunday mornings — so every route that orders food answered "no longer
available" and the suite failed on a Tuesday for a reason that had nothing to do
with the code. It now picks from a menu that is active AND unscheduled, and
throws rather than continuing if there is none. When a fixture asks the database
to choose, make it state every condition it is relying on.

**A check run against a switched-off feature asks nothing.**
Two attack cases about dividing a bill passed the day they were written, with
the bug still in the code: no restaurant in the dev database has a Stripe
account, so `/api/bill/pay` refused at the door and the case never reached the
question it existed to ask. They now switch cards on for the length of the
case and put them back. Before believing a green check, ask what the FIRST
refusal on that path is and whether the case gets past it.

**SUBSCRIBED is the client saying it asked, not the server saying it is wired
up.** `pnpm rls` subscribed the kitchen to its own restaurant's orders, planted
one, and waited. Every so often the channel reported SUBSCRIBED and delivered
nothing, and the check — correctly — refused to build the cross-tenant
assertions on a socket it could not prove was live. It looked exactly like a
broken app and was never one. The first ticket can fall into the gap between
the two; a second one a breath later cannot fall into the same gap, so the
liveness step plants twice before giving up. (The missing `realtime.setAuth` was
the first suspect and is now stated outright, matching `useLiveOrders` — but
removing it does not reproduce the failure, so it was not the cause.) Proved
both ways: green over a dozen runs, and still red when pointed at a
subscription nothing can ever deliver to.

**Ask what the key is keyed by.**
The tracker offered a diner the order they had placed at a different table,
because the memory was keyed per restaurant when the thing it described was per
table. When storing state about "the current X", write down what makes one X
different from the next.

**A schema only counts if it builds from empty.**
`schema.sql` could not, for months: storage policies called `has_role()` a
hundred lines before it was created, and it only ever worked because a reset
left the old function behind. `pnpm db:reset` on dev is the only thing that
proves it.

**A guard that redirects still answers 200.**
Next's `redirect()` from a server component replies to a document request with
the *target's* HTML and no `Location` header. A checker written on
`status === 200` reported 17 permission holes that did not exist. Probe a page
by a marker string only that page prints — never a nav label, which every page
carries. That is what `pnpm roles` does.

**Reaching a page is not seeing all of it.**
A manager opens Ajustes but must not see Zona horaria or Pagos; a waiter opens
Cuentas abiertas but must not see the activity log. When a module moves between
screens it inherits the audience of the new screen, and nothing in the types
says so. Assert the sections, not just the routes.

**A grid turns every child into a cell, headings included.**
"Mesas por cobrar" and "Otras cuentas abiertas" were `<p>`s inside a
three-column grid, so each took one cell and the cards flowed around them —
tables appeared under the wrong title, and a table that had not asked to pay
read as waiting. A heading inside a grid needs `grid-column: 1 / -1`.

**`min-width: 0` on the only elastic column is how text ends up under a badge.**
The bill row's name collapsed to zero width the moment a table carried a badge:
the text overflowed and the amount owed sat behind the Cobrar button — on a
phone, which is the waiter's screen. Give the elastic child a real minimum and
let the row wrap instead. Then grow the skeleton by the same line
(`bills/loading.tsx`), or the list jumps when it loads.

**A checker that filters out the broken case will always pass.**
The first version of the layout audit skipped every element with
`width === 0` as "not visible" — which is precisely the shape of the bug it
was written to catch, so it went green on a cart whose dish name was squashed
to nothing. It also measured `scrollWidth`, which is always 0 on an inline
element like the `<strong>` holding every dish name. **Prove a new guard by
breaking the thing on purpose and watching it fail.**

**Text can be unreadable while every test passes.**
The cart line that a customer sees before paying spent a release with the dish
name at 38px on a phone — one word per line, the promo badge painted over the
struck price, the amount hidden behind the button. Nothing failed. `pnpm layout`
is what now catches this: every screen, phone and desktop, checked for text
squashed to nothing, text over text, and the page running off the side.

**A label folded in half is invisible to every check that measures boxes.**
On a phone the activity log printed "DESCUENT / O", the kitchen board stood
"Marcar listo" two lines tall beside a one-line "Cancelar" and pushed "Empezar a
preparar" out over the edge of its own card, and the Cobrar button on a bill row
left the screen entirely and took the page's horizontal scroll with it. Every
box was wide enough to measure and nothing overlapped, so `pnpm layout` went
green through all of it. It now also fails on **`partido`** — one short word, or
any button label, painted on more than one line. A button label is a label:
`.tt-btn` refuses to break, and the row it sits in wraps instead.

**Two switches for one decision will disagree, and the owner sees only one of
them.** Paying at the end (a table) and paying at the till (the general QR) were
`allow_pay_later` and `allow_counter_payment`. They are the same question — may
the food leave before it is paid for — and who holds the order is decided by the
QR, not by the restaurant. An owner with the first on and the second off got a
general-QR cart with no button on it at all. They are one column and one switch
now, "Pagar al final / en la caja", on the paid plans.

**A count that goes down only when the money lands sells the same portion
twice.** Stock is taken at checkout, before the diner is sent to Stripe, and
handed back by the webhook's abandon handler and by an order being cancelled —
the same reserve-then-release shape coupons already had. Counting down on
payment instead would let two tables each be sold the last portion while both
sit on a payment page. `reserve_stock` locks the rows it touches in id order,
which is what makes ten simultaneous attempts on one portion produce exactly one
winner; the check that proves it is a concurrency test run by hand against the
dev database, and it is the thing to re-run if that function is ever edited.

**A dish the system hides is not a dish a person hid.** When stock reaches zero
the dish comes off the menu automatically and `stock_auto_off` records that we
did it, so giving the stock back can put it on again. Without that column, an
abandoned checkout returned the count and left the dish invisible, and the only
clue was a number that disagreed with the switch beside it. A dish the
restaurant switched off by hand stays off — releasing stock never overrides
somebody's own decision.

**Storing a notification's sentence freezes it in one language.** The bell keeps
`kind` and the facts, never the wording. A restaurant that reads the dashboard
in Spanish and switches to English would otherwise find last week's warnings
still in Spanish, because the row was written by a server that had no idea who
would read it.

**An error that bypasses `apiError` speaks one language forever.** 237 API
errors resolved in the caller's locale and 7 did not, because they wrote the
sentence straight into the response. A Spanish owner who reused a coupon code
was told "That code already exists."; a diner under the card minimum got English
in the middle of paying; and one invite failure answered every English speaker
in Spanish. `invariants.spec.ts` now refuses any sentence in a route under
`src/app/api` except the Stripe webhook, whose reader is Stripe.

**The English rule was enforced on comments only, so the output drifted.** Every
check printed its verdict in Spanish — `MAL`, `rebota de /dashboard`, `comensal
es · carrito`, six layout faults named `aplastado`, `encimado`, `desalineado`,
`partido`, `descentrado`, `desbordado` — and no test could see a word of it,
because the guard read comments and nothing else. `english-code.spec.ts` now
also reads the string literals in `scripts/`. Text that must match the Spanish
UI belongs behind a matcher key (`text:`, `marker:`, `expect:`, `es:`), which is
what tells the guard it is data about a Spanish thing rather than words written
to a developer.

**The same demo login was described twice.** `roles-check` carried its own list
of the five demo accounts and `layout-paths` carried another; rename an account
in one and the other signs in as somebody else, or fails and blames the app.
They agreed by luck, not by anything checking. Now an invariant compares them.

**Money a cashier signs for was a substring.** The till and the corte were
built by parsing `amount=120 method=cash` out of the activity log, so a row
written a little differently added nothing and still counted as a settlement,
and the two records of one night's cash — the log the cashier signs and the
ledger the owner audits — had nothing comparing them. Both now read `payments`,
where the amount is `numeric not null check (amount > 0)` and the method is one
of two words. `pnpm money` reconciles the log against the ledger per person and
method, from the moment the ledger began naming who took the money; the backfill
before that could not know an actor and is not its business.

**Cash with nobody's name on it belongs to no drawer.** Card can arrive with
nobody standing there — a diner pays online and the webhook records it — but
cash was physically handed to a person, and the corte is grouped by exactly
that column. `pnpm money` checks the rows and an invariant checks the code, so
a new settlement route cannot ship without an actor and wait to be noticed in
the data.

**A status change made on a dropped connection was thrown away.** The kitchen
board moved the ticket optimistically and fired the PATCH with no `catch`, so
the tap showed as applied to whoever made it and never happened to anyone else.
Those moves are now held and sent when the connection returns. Only status
moves: a settlement replayed on reconnect charges a table twice, so settling,
cancelling and approving refuse while offline and say why — an invariant keeps
every other module out of the queue.

**A queued move must not beat live work.** A waiter's "preparing", held through
a drop and flushed later, would have dragged back an order the kitchen had
already called ready — stale work quietly overwriting current work. Each queued
move now carries the status it started from and `PATCH /api/orders` applies it
only if that is still the current status, answering `superseded` otherwise.

**Detecting a drop is not the same as recovering from one.** The first version
went offline on a failed request and waited for the browser's `online` event to
come back — an event that never fires when the tablet never left the wifi and
it was the router's uplink that died, which is the commonest way a restaurant
goes offline. The board sat behind a banner with work in its pocket long after
the connection returned. Found by stopping the dev server, moving a ticket and
starting it again: nothing came back on its own. It now probes while it
believes it is offline.

**The service worker cannot be exercised in the preview browser.** Service
workers do not register there at all — a one-line worker fails identically — so
`service-worker.spec.ts` runs `public/sw.js` against a stand-in scope instead,
and checks what it caches, what it refuses to cache (bills, every API call) and
that a sign-out empties it.

**One webhook route cannot serve two Stripe accounts.** Checkout moved to
direct charges so Stripe would stop billing the platform MX$13.80 on a MX$300
ticket — right call, and it moved every diner payment's events onto the
restaurant's account while subscriptions stayed on ours. Stripe issues a
separate signing secret per endpoint, and the route read one, so registering
both endpoints would have failed every event on one of them with a 400 that
looks exactly like a delivery problem. Now two routes, one secret each, and an
invariant that fails if they ever read the same secret or start handling each
other's events.

**A counter sale filed away from the money it took.** The till recorded its
payment in the ledger but logged the event as `order/paid`, while the drawer
and the ledger are reconciled against `bill/paid`. The two records of the same
cash disagreed by exactly the counter's takings, and `pnpm money` said so on
the first sale. A counter sale is money taken, so it files where money is filed.

**A staff client cannot read a restaurant's own settings.** The till first read
`restaurants` with the cashier's session and got nothing back: the column
grants deliberately give a browser only what a diner's menu needs, so
`service_pct` is not among them — and a till that cannot read the service
charge cannot price a sale. It reads with the secret key now, scoped to the
actor's own restaurant, which is what makes that safe.

**A cart is priced from the rows the server fetched, so it has to fetch them
all.** The till looked up only the dishes a sale referenced, not their extras
or a bundle's components — and `verifyCart`, which prices only what it is
handed, read the missing extras as extras that had vanished. Every sale with an
extra on it failed with "no se pudieron verificar los productos". Checkout had
the right list all along, with a comment in capitals saying products AND
extras; the till was written beside it rather than from it. Both now call
`referencedItemIds`, which lives next to the function that consumes it.

**A guard that only knows one shape of route checks nothing outside it.** The
list `pnpm api` reads was matched against route folders by string containment,
which works right up until a route has a `[token]` in its path — and the first
one the app ever had would have been waved through by any stray mention of it
anywhere in the file. The check now collapses `[segment]` on one side and
`${...}` on the other to "one segment, contents unknown" and compares the
patterns, so a dynamic route is covered by a case that actually requests it.

**An indent written into the text is eaten by the code that wraps it.** The
kitchen ticket built each modifier as `"   " + text` and handed it to a wrapper
that splits on whitespace — which stripped the leading spaces off the first
line and kept them on every continuation. Every modifier printed flush against
the dish above it, and it looked deliberate. The indent is applied to all the
lines by the wrapper now, after the split rather than before it.

**A trigger that raises rolls back the row that fired it.** Queuing the kitchen
ticket is an `after insert` on `orders`, which means anything that can make the
queue insert fail — a constraint nobody predicted, a table caught
mid-migration — would have taken the paid sale down with it. A restaurant would
have lost money because a printer queue hiccuped. The insert is wrapped in a
block that swallows everything now, and the failure mode was proved by breaking
`print_jobs` with an impossible constraint and watching the order save anyway.
An order is money; a print job is paper.

**The framework is a dependency too.** `pnpm audit` had been reporting two
CRITICAL unauthenticated RCEs against Next itself — one of them CVSS 9.5, via
AVIF decoding in the image optimiser, affecting Vercel deployments and not only
self-hosted ones — and the fix was a patch bump inside 15.5.x. Nothing in the
app's own code was wrong; the whole exposure was a version number nobody had
looked at. `security-headers.spec.ts` now fails if the range can resolve below
15.5.24, because a caret range silently drifting backwards is exactly how this
returns.

**A money app that can be framed can be clicked for you.** Production sent HSTS
from Vercel and nothing else, so any page could put `/dashboard` in an iframe,
overlay its own buttons and let a signed-in manager approve a refund or write
off a table without seeing what they pressed. `frame-ancestors 'none'` plus
`X-Frame-Options: DENY` now, verified by actually framing it in a browser and
watching the load be refused. `payment` is deliberately left OUT of the
Permissions-Policy: checkout is a redirect today, and a header nobody remembers
writing is a bad way to discover Apple Pay does not work.

**A webhook Stripe delivers twice was money that arrived twice.** Stripe
re-sends an event whenever it is not sure the first delivery landed.
`checkout-settle.ts` says in its own header that every path is written to
survive that — and two of its three paths had no guard at all: `settleBill`
updated by id without `.eq("paid", false)`, and `settleOrder` marked the row
paid, then read it back in a *separate* query and recorded a payment whether or
not this delivery was the one that changed anything. Reproduced by calling
`settleCheckout` twice with the same session: one payment became two rows. The
ledger, the corte and the day's takings would all have counted it twice. It
never bit only because the webhooks have never been registered — it would have
fired on the first real payment after they were. Both guarded now, plus
`payments_one_per_intent` so the next settle path cannot get it wrong, and
`recordPayment` treats the refusal as "already recorded" rather than an error.

**A row policy is not a column policy.** `owner manages restaurant` is
`for all using (owns_restaurant(id))`, which reads as though it grants an owner
the settings they edit. It does not: a policy decides which ROWS a statement
may touch and never which columns, and Supabase's default table-wide grant to
`authenticated` was still in place. So an owner could open the browser console
and write any column of their own row — `plan` to grupo, `plan_status` to
active, `trial_ends_at` to 2099, and `stripe_account_id` to any account they
named. Proved by doing all four and reading the values back with the secret key.
Every legitimate write to that table already went through the server, so the fix
is a revoke; `plan_limits` — the platform's shared price list, world-readable on
purpose — got the same treatment.

The near miss is worth recording too: the first probe asked whether the write
returned an ERROR, and a write RLS filters to zero rows returns no error at all.
By that measure four more tables looked wide open — the ledger, the audit log,
the price list, marking an order paid — and all four were fine. **Measure the
effect, not the absence of a complaint.**

**The UI enforced the price list and the database did not.** Five of the eight
tiered features are refused by an API route. Three were not, because the menu
editor writes them straight to Postgres with the browser's own key — so a
restaurant on the free tier could set a stock count or a menu schedule by
calling Supabase directly, with nothing but its own manager login. No RLS
policy consults the plan. `enforce_plan_feature()` does now, on the two columns
that were reachable, and it deliberately skips the server (`auth.uid()` is
null when the secret key writes, and stock is decremented on every order) and
only refuses a write that SETS or CHANGES the value, so a downgrade cannot
freeze the rows it already touched.

**The account holding the money had the weakest password rule.** A platform
admin creating a staff login was held to eight characters. The owner signing
up — the account with the Stripe connection, the staff list and the settings —
was held to six, in the route and in both forms. One constant now, in
`src/lib/password.ts`.

**An open mail endpoint was limited by sender, not by subject.** `/api/receipt`
capped requests per IP, which bounds how fast one machine can send and not how
much: anybody holding a single order id could point our sender at any address
they liked, five a minute, indefinitely, from our own domain. Capped per order
per day as well.

**A guard that reads string literals cannot see a variable.** Six routes handed
the client a raw `error.message` from Postgres — the column, the constraint,
sometimes the value that broke it, always in English — and the invariant that
exists to stop exactly that saw nothing, because it scans for sentences written
as literals. It reads both now.

**The session cookie was not marked Secure.** Read off a real production
login: `sameSite: Lax` (which is what stops a cross-site POST carrying it, and
was already right), `httpOnly: false` — unavoidable, Supabase's browser client
writes and reads it with `document.cookie` — and `secure: false`, on an HTTPS
site. HSTS is sent with `preload`, so no browser would have made a plaintext
request to the domain and nothing was leaking; the flag was simply not saying
so itself. It follows `location.protocol` rather than `NODE_ENV`, on purpose: a
build variable would have to be guessed right for an environment this can never
be tested in, and guessing it wrong sets `Secure` on a cookie served over http,
which the browser silently drops — and then nobody can log in at all.

**A sweep that finds nothing because there is nothing to find.** The
cross-tenant check added after the security review walked every table as every
role and reported six clean rows — while passing vacuously on twelve of
twenty-one tables, `orders` and `payments` among them, because the other demo
restaurants have no rows at all. A green tick for a question never asked. It
was caught by planting a real leak and watching the sweep miss it. It plants
its own neighbour fixture now, names every table it could not reach, and fails
outright when one of the four that matter has nothing to attack. In production
it plants nothing — a probe order there is somebody's real takings — and says
so instead.

**Measure the effect, not the absence of a complaint.** Twice in one review a
probe reported a leak that was not one. A write RLS filters to zero rows
returns no error, so "did it error?" reported four tables as wide open that
were all fine; and an owner reading a profile that was not their staff's turned
out to be reading their own. Both dissolved on measuring what actually changed.

**A tip could make a sale cheaper.** `tipFor` multiplied the subtotal by the
percentage it was given and clamped nothing. The diner's checkout was safe by
accident of a different guard — it allow-lists 0/10/15/20 — but the till passed
the request's number straight through, so `tipPct: -50` charged less than the
food costs. The part that makes it worth more than a shrug: **the drawer still
reconciles afterwards.** The order's own total was computed with the same
negative number, so `orders.total` and `payments.amount` agree and `pnpm money`
sees nothing wrong. A cashier undercharging a friend leaves no trace anywhere.
Clamped in `tipFor` rather than at the caller, because the caller is exactly
what was inconsistent — and `tipAmount` now rejects NaN and Infinity too.

**NaN survives a clamp.** `Math.max(1, NaN)` is NaN and so is the `min`, so a
cart line with `qty: "abc"` reached the insert as NaN and came back as a 500
from Postgres — an unhandled crash on the route that takes money rather than a
refusal. `clampQty` reads a line that is not a number as one.

**A grant nobody needed answered a question nobody should ask.** `plan_ceiling`
was executable by `authenticated`, and nothing in the app calls it from a
browser — the trigger that uses it is SECURITY DEFINER and runs as its owner.
What it did allow was a kitchen hand at one restaurant asking what ANOTHER
restaurant's plan permits; "50 tables" is enough to read a competitor's tier off
the answer. Revoked, and the trigger still enforces — proved by overfilling a
carta restaurant afterwards.

**A clean checkout failed its own money gate.** `pnpm db:mock` seeded sixty
days of takings and left the payments to the backfill in `schema.sql` — which
names nobody, correctly, because it exists for orders settled before the ledger
did and that history is genuinely unrecoverable. But the seeder keeps MAKING
new history, and the backfill anonymised it, so `pnpm money` reported "cash
payment(s) with nobody named" on a freshly seeded database. Intermittently, too:
the check exempts everything before the first payment that does name someone, so
whether it fired depended on where the random dates fell. A gate that fails on a
clean checkout is a gate people learn to ignore — which is the one thing the
money gate cannot afford.

The seeder writes the ledger itself now, with a real cashier or waiter on every
cash payment, and writes the matching `bill/paid` log beside it so the corte and
the ledger are one fact recorded twice rather than two guesses. One hand-written
demo log went with it: it claimed MX$412.00 of cash that no payment had ever
backed. Proved by reseeding three times and reconciling on each.

**The demo stopped looking like the app.** The seeder is written once and the
schema keeps moving, and a column added later is not a syntax error in
`mock-data.mjs` — it is a column the demo silently leaves null. Two had drifted:
every cash payment named nobody (so the corte could not be built from the demo
at all, in dev or in production), and no menu carried a schedule — including one
literally named "Weekend Brunch", so the whole menu-hours path was never once
exercised by any gate that reads seeded data.

`pnpm seed:shape` now walks the tables the demo fills and fails when a column
the app reads is null in every row, or when a shape the app depends on is
missing entirely. Run it against production too: that is where the drift is
least visible and most expensive.

**The kitchen could count the drawer.** `payments` was readable by
`works_at(restaurant_id)` — the whole team, the pass included. That was
invisible for as long as every seeded payment was anonymous and the corte could
not be computed from them at all; the moment the ledger carried real amounts and
the name of whoever took the cash, it meant a kitchen hand could read the
restaurant's entire takings and see what each person on the floor had collected.
Nothing kitchen-facing reads payments — both screens that do are behind
`requireSettles` and read with the secret key — so narrowing the policy to
manager, waiter and cashier costs nothing.

Worth recording how it was found: not by reading the policy, which had been read
before and looked fine, but by re-running the checks after the demo data
changed. A permission is only as visible as the data behind it.

**A rename that only drops the old name breaks the file.** The same change
replaced `"team reads payments"` with `"the floor reads payments"` and dropped
only the former, so `db:create` succeeded once and failed on every subsequent
run with "policy already exists" — which would have broken the next production
migration. `schema.sql` re-runs on every deploy; a policy rename has to drop
BOTH names. It hid a second fault too: the regression plant appeared to pass
because the schema apply had silently failed, so the guard was never exercised.
Verify the apply, then plant.

**A nav link that could never appear.** The root layout built the list of
features the navigation gates on BY HAND — `can(plan.limits, "pos") ? ["pos"] :
[]` — so the next tiered area added to the nav was filtered straight back out of
it by a line that had no idea the area existed. The waiter's order screen was
correctly in `NAV_ITEMS`, correctly allowed for the role, on a plan that
includes it, and the link simply never rendered. Nothing failed; the tests
passed; only opening the page in a browser showed it. `NAV_FEATURES` is read off
the items now, so adding a tiered area is one edit rather than two, and a test
fails if the two ever disagree.

**The money gate would have failed the first table to divide its bill.** A share
of a divided bill belongs to no single order — a third of MX$100 across orders of
60 and 40 is an amount that belongs to neither — so the split records it against
the sitting, and marks the orders paid together when the pot is full. `money`
skipped payments with no `order_id` outright and then reported those orders as
settled with no money behind them. It never fired because no split has ever
completed; the first table to finish one would have failed the gate for doing
exactly what the design intends. Reproduced by building the shape a completed
split leaves behind.

The check now follows the model instead of fighting it: an order is backed by
its own payment OR by its sitting's, and a new check says the thing per-order
attribution never could — that a sitting settled as a whole collected at least
what its orders came to. Proved both ways: 50 + 50 against 100 passes, 50 + 30
names the sitting and the shortfall.

## A gratuity charged and never written down

`/api/split/pay` stamps `settle_tip` on the Stripe session, Stripe charges the
share plus the tip, and the money lands in the restaurant's account. Then
`settleSplitShare` recorded the share alone. The tip appeared in the app
nowhere: not in `payments`, not on `orders.tip`, not in the day's takings. Our
own `settle_fee` went the same way, which is what the monthly fee ceiling is
summed from — so a divided bill could let us take more in a month than the
ceiling allows.

It survived because the key was not unread. `settleBill` reads `settle_tip`,
so anything looking for an orphaned metadata key found it. The other settle
path simply never asked.

`invariants.spec.ts` now checks each checkout route against the ONE function
that settles what it sent: `split/pay` against `settleSplitShare`, `bill/pay`
against `settleBill`, `checkout` against `settleOrder`. Proved by putting the
bug back and watching it name the route, the key and the function.

## Money on a sitting, spent twice

A bill collected in parts records the money against the sitting rather than any
one order. The balance then subtracted every payment a sitting had ever
carried, including the ones that had already closed the orders they paid for —
so a table that paid MX$200 and then ordered MX$60 more read as owing nothing.

Found by `pnpm attack`, which asks what a signed-in person can do that they
should not and judges every case on effect. What settled an order is now
deducted from it, and only the surplus pays for what is left. `creditFor` is
pure and has the arithmetic under test.

The same run found `staffOpenedBill` asking about the sitting open right now
rather than the sittings the routes would actually charge for — so a waiter's
bill whose sitting had closed with something still owed became payable online
again.

## A backfill that would have doubled every divided bill

`supabase/schema.sql` ends with a backfill inserting one payment for every paid
order that has none — which is exactly the shape of an order settled as part of
a TABLE. A share of a divided bill has been that shape since splits shipped.
It runs on every deploy, so the next production migration would have recorded a
second payment for every such order. It did exactly that in development:
MX$98.78 against a sitting that had already paid MX$98.78.

Production had no completed split, so nothing there was affected. `pnpm money`
now fails on a sitting holding MORE money than it owed — the direction nothing
checked, because it is the one that flatters the takings.

## A camera header that refused our own camera

`Permissions-Policy: camera=()` is an EMPTY allowlist — it denies every origin,
including the page that sent it. The scan-to-collect button shipped and could
never open a lens; `document.featurePolicy.allowsFeature('camera')` was false
on every page in production, and the failure looked exactly like a customer
declining the permission.

Found while adding a second scanner beside it, which would have been dead on
arrival. It is `camera=(self)` now, and `security-headers.spec.ts` asserts it.

## An inline handler the policy would refuse

The printed ticket said `<body onload="window.print()">`. Under the new
Content-Security-Policy that is script the browser refuses, and a ticket that
opens and never prints is worse than one that never opens. The opener prints
it now, waiting for the same moment `onload` did — printing before the
stylesheet applies puts an 80mm ticket on a Letter page — and the test asserts
the document carries no inline handler at all.

The other two print windows had always done it this way. Two ways of doing one
thing, and the policy only broke the older one.

## Two waiters, one table, MX$400 for a MX$200 dinner

Two waiters collecting the same table at the same moment each read the balance
before the other had written, so both collections landed in full. Invisible from
an owner account: it takes two logins at once. `collect_on_sitting` holds a
transaction-scoped advisory lock on the sitting, so reading what is owed and
writing what was taken are one step. `pnpm attack` fires five collections at
once and asserts no more than the bill lands, and that the losers are told the
bill is covered.

## Garbage in, five hundred out

A body that was not JSON — or was `null`, an array, a bare string — reached
routes that called `req.json()` and destructured it, and came back a 500. On a
money route that is an unhandled exception in the path that takes payment.
`jsonBody` returns an object or nothing, and the invariant fails any route that
parses a body by hand.

## An order with no ceiling

Nothing capped a cart. One request built a ten-thousand-line order: MX$115,500 on
the board as a single card, 3.9 seconds of server time, a kitchen ticket queued
for a printer that would still be spooling at closing. The first cap sat after
the query it was meant to protect — two hundred lines with ten extras each is two
thousand ids in a PostgREST `.in()` filter, which is a Bad Request at a thousand
and a 414 at five. `cartReferences` measures a cart before its rows are fetched.

## A refusal that read as a dead connection

`/api/table-order` answered `{ rejection }` with no `error` field, and the
waiter's screen falls back to "Error de red" when there is no message. A
sold-out dish read as a lost signal, so the waiter retried instead of telling the
table. The same toast that started the investigation, on a path nobody had
traced. Every refusal's wording now lives in `rejectionMessage`.

## A failed read taken for a paid bill

`/api/bill/pay` did not check its orders query for an error. A lookup that broke
returned no rows, which the route reads as nothing left to settle — so the diner
was told their bill was paid. A read that failed now answers 503, and the id
list that broke it is capped at `MAX_BILL_ORDERS`.

## Fourteen orders, one card, no way to pay

`settle_order_ids` was a comma-joined list of uuids, and a Stripe metadata value
stops at 500 characters: thirteen orders fit, the fourteenth did not. Over the
limit Stripe refuses the whole session, the route says "checkout failed", and
tapping again does the same. Two more ceilings with the same shape — 100 line
items per Checkout Session, so the card cart caps at 98, and 250 characters per
product name, which a dish name typed in the browser can pass. The list is spread
across keys now, and the first keeps its old name so sessions created before the
fix still settle.

## A discount given and never written down

`/api/checkout` returns for a pay-later order before the one call that logs a
coupon redemption. The limit held — `redeem_coupon` had counted the use — and the
order carried its discount, but nothing recorded which order got how much.
`pnpm money` now requires a redemption for every order carrying a coupon, for the
same amount, and was watched failing with one removed.

## A refund the till cannot give

A cash-paid order could never be cancelled. The route looked for a Stripe payment
intent, never found one, and answered "payment still settling, try again" for
ever, while the dialog offered to refund the amount. Cash is told apart from a
card whose webhook has not landed now, and the payment stays on the ledger, which
`money-check` already expects of a cancelled order. There is still no way to
REVERSE a cash payment — `payments.amount` must be above zero — so handing the
money back is left to a person.

## An honest waiter counted short

The fix above made a cash sale cancellable, and so made this reachable. The cash
arrived, the payment stayed, and the cancel wrote only `order=…` — so the corte
went on expecting MX$100 in the drawer of the waiter who had just handed it
back, and called them short by exactly that. A card refund stayed in the card
total the same way. `pnpm money` was blind to it: the ledger and the collection
log both said the money came in, which it had, so the drawer check agreed with
itself. The cancel now writes one `refunded` line per payment it reverses, with
the amount and the person who took it; the corte subtracts it from their line,
and `pnpm money` requires the lines to add up to the payments. The same pass
found two cancels racing both succeed — a second handback, and the stock put
back twice — so the write is conditional on the status it read. Reproduced
through the route and the screen before and after: MX$100 expected, then MX$0
and "Handed back MX$100"; a double click answered 200 and 409.

## Nine oks for screens nobody saw

Supabase timed out for a moment during `pnpm promises`, and the manager's
sign-in failed. The script did not look: it built a cookie out of the word
"null", every page redirected to the login screen, the login screen offers
nothing to search, and nine screens printed ok. The run only went red for an
unrelated reason. `pnpm layout` had the same shape, and in `pnpm rls` a failed
kitchen sign-in left an anonymous key checking whether "staff" could read the
Stripe columns — which it cannot either, so the check passed for the wrong
reason. Every script sign-in now reads its error, and an invariant fails on one
that does not; each gate was watched failing with the password wrong. The first
run with the fix found one more: `pnpm promises` had signed in as the platform
admin with the demo password on every run there had been, failed, and checked
the admin screen signed out — ok, each time.

## Still settling, for ever

The fix for cash told cash apart from a card whose webhook had not landed. Every
other card with no payment intent on the ORDER stayed on the wrong side of that
line: a card sale rung up at the POS, a table settled by card at its terminal,
and — the common one — any order of a table whose bill was paid online in one
go, because `settleBill` stamps the intent on each order's payment and never on
the order. All were answered "payment still settling, try again" for ever,
while the dialog promised "the customer will be refunded". Reproduced on dev
before the fix. What a cancel gives back is now one function reading the
ledger, used by the route and by a GET the dialog asks first; Stripe refunds
each payment for its own amount, and the rest is worded as what a person has to
give back. Restaurants have Express dashboards, which cannot refund, so the copy
does not send them to Stripe. Watched failing with the plan blind to a
payment's own intent, and with the old refusal put back.

## Off the board, still on the badge

The orders board loaded the newest 100 orders of every status and kept the live
ones. After a busy stretch — 100 newer orders is one lunch — an order the kitchen
had not started was not loaded at all, and a reload took it off the screen,
while the Pedidos badge, which counts by status, still counted it. Two places
defining "live" differently: a status on one side, a recency window on the
other. Reproduced with one order older than dev's newest 100 (board: none of it;
database: one), and fixed by seeding the board with `LIVE_FLOW` itself.

## The gate that emptied the board

`pnpm dialogs` clicks every visible button on every screen, and most buttons do
not open anything — they act. Measured once, a single run sent 72 writes: it
completed all thirteen live orders on the demo board, moved menus and categories
up and down 24 times, paused and resumed promotions, duplicated four dishes that
were never removed, saved the settings, closed service requests, approved a
write-off and turned down a discount. Every later `pnpm layout` found no order
on the board, printed "order detail: did not open (no data)" and moved on — one
gate had switched another gate's check off, and both printed green. Writes from
the sweep are now answered in the browser and never reach the server, and the
demo data is fingerprinted before and after; a run with the holding switched off
fails on the fingerprint, naming orders, items, promotions, requests, write-offs
and discounts. With it on, the whole gate chain leaves the board's thirteen
orders where it found them.

Making it unable to write showed the next thing: both seeds left accounts on the
terms modal — `test-users.mjs` kept its own copy of the version, a month behind,
and the demo restaurant recorded none — so the sweep measured every owner
screen from underneath the modal. The seeds read the version from
`src/lib/legal.ts` now, and an invariant refuses a copy.

## Renaming ran off the page

Renaming a menu happens in the breadcrumb: a fixed 220px field and two buttons,
in a box that could not shrink, inside a row that cannot shrink below its
content. At 390px the row came out 458px and the whole page scrolled sideways.
Nothing measured it — `pnpm layout` opens a list of dialogs and `pnpm dialogs`
only audits what opens as one, and renaming is neither. It surfaced by accident,
when the terms modal was open underneath and made the pencil look like it had
opened something. The field now takes what the row can spare, the two buttons
drop beneath it together on a phone, and `layout-paths` can name a state by what
it `shows` — so the rename is measured at every width, and failed on the old
code at 390px for the owner and the manager.

## A schema that only rebuilt itself

`schema.sql` is run against databases that already have everything, where a
statement about a table created further down succeeds because the table is
there from last time. Run against nothing, the whole script fails on it — and
`pnpm db:reset` drops every table first, so a failure there leaves an empty
database behind. Two statements did this for two weeks: a revoke on
`plan_limits` four hundred lines above the table (#296, the security review),
and a revoke on `enforce_plan_limit()` seven lines above the function. It was on
the checklist — "`pnpm db:reset` on dev, proves the schema still builds from
nothing" — and nobody had run it. Found by running it; dev was left with no
tables until the fix. `schema-order.spec.ts` now fails on any table or function
named before it is created, and named exactly those two on the old file.

## A seed that failed by the roll of a die

The demo restaurant prints kitchen tickets by itself, so the trigger queues a
ticket for every order still at the pass. The seed then added "one ticket
already printed" for the newest order — and when the dice made that order one
still at the pass, the two collided on `print_jobs_once` and `pnpm db:mock`
stopped half-built, with the loyalty cards and everything after the tickets
missing. It passed often enough to look fine. The seed now marks the queued
ticket printed instead of adding another; the collision was reproduced against
a real queued ticket before the fix and does not happen after it.

## The seed that stamped today

The demo's visit cards were seeded with days in UTC, while a real stamp is dated
by the restaurant's own calendar. After six in the evening in Mexico City, "one
day ago" in UTC is today there — so the seed quietly took today's slot, and the
card's first real scan answered "this card already has today's visit". Caught
by driving the scanner in a browser, where the halfway card refused its first
stamp; the api case for "first visit today" would have passed or failed by the
hour. The seed dates visits in the demo's time zone now, and never today.

## A month too wide for a phone

Analytics' four tiles sat in `repeat(2, 1fr)` on a phone, and a plain `1fr`
column will not shrink below its content: over thirty days "MX$1,497.71" in 24px
bold made its column 200px of the 358 there were, and the page scrolled 21px
sideways. "Today" has short numbers, and `pnpm layout` only ever opened today,
so it measured the page clean every time. The columns are `minmax(0, 1fr)` now,
the figure is sized by its tile (`clamp(14px, 14cqi, 24px)` in a size container)
so it stays whole down to 320px, and layout opens the thirty-day view too. The
loading skeleton had its own fixed guess, 72px tiles under a 38px row of pills,
off by up to 6px at every width; it is built from the real tile now and matches
at 390, 820 and 1280px.

Opening the thirty-day view found three more. The day chart put thirty labels
inside thirty bars, each 5px wide on a phone and 19px on a tablet; the labels
have their own row now, about seven of them, each as wide as the bars it names.
Layout's list of faults stops at twelve, and those thirty squashed labels had
filled it — so on the old CSS the page scrolling sideways, the fault that
mattered, was the one cut off; page-level faults go first now. And every label
said "Tue": `new Intl.DateTimeFormat([])` formats in the machine's language, and
the host's is English. The labels take the reader's language, the coupon list's
dates did the same thing in the browser's language and are fixed too, and an
invariant now refuses a date formatted in the machine's default.

## Dates in the browser's language

Eight screens — the order cards and their detail, the history, the activity
log, the notifications, the plan and its documents, and the admin panel —
formatted dates with `toLocaleString([])`, which answers in whatever language
the browser is set to. A Spanish owner on an English phone read "Sep 22, 09:59
PM" beside Spanish words, and the server rendering the same component could
write it in a third language. They take the app's language now, through
`dateLocale(locale)`, from the same cookie the server and the phone both read;
checked with the app in Spanish on an English browser and the other way round,
with no hydration warnings, and an invariant refuses `[]` or `undefined` as a
date's locale — it named all eight on the old code.

## A gate that failed by the clock

`pnpm promises` opened each state's page, waited 1.7 seconds and judged. On a
slow compile the plan lock arrived after that, and "free plan · promotions"
failed as "shows nothing and explains nothing" — then passed on the rerun. A
gate that goes red over nothing teaches people to rerun it until it is green,
which is how a real red gets waved through. Each case now waits, up to ten
seconds, for its own sign that the page is there: the control it opens, else the
control it must keep, else its words — in that order, because the words can be
on the page first: "Cuentas" is in the navigation while the bills still load,
and the first version of this waited on it and judged the skeleton. Three runs
in a row clean; a case pointed at words its screen never says still fails.

## The decoder under the optimiser

The second time the image optimiser was the worst finding in a security pass.
`sharp` 0.34.5 shipped with CVEs in libvips and libheif, and `next/image` runs it
on menu photography a restaurant uploads. Next accepts `^0.34.3 || ^0.35.4` and
pnpm had picked the vulnerable half. Found by `pnpm audit`, fixed by an override,
proved on production by an image coming back as WebP. Of the other twenty-four
advisories, sorting by where the code runs showed only `qs` also reached a
server.

## A trial that never ends

`plan_status` defaults to 'trialing' and `trial_ends_at` to nothing, so an insert
that names neither starts a trial `getPlan` can never settle. The admin screen
opened accounts that way, and the owner read "Prueba · quedan 0 días" for ever.
`plan` defaults to carta, so nothing was given away — it was the status that
lied. The invariant that guards it passed with the fix reverted, twice, before it
read the insert itself rather than the file around it.

## Measured at 390, carried at 360

Every sweep opened phones at 390px, the iPhone, and 360 is the most common
Android width. No breakpoint falls between them, so a 360 phone gets the same
rules with 30px less room, and two screens did not have the room. The menu
editor's product row (price, switch and four buttons) could not shrink: at 360
it already ran 28px past its own box, hidden by the card's padding, and at 320
it pushed the whole page 30px sideways. Now its actions wrap under the price
only when there is no room, and nothing moves at 390. Analytics' top-products
table kept a fixed 70px for two digits and 110px for a 73px amount, which left
the dish names 78px, so "Cheesecake" broke mid-word. The table owns its columns
now, every row is a subgrid of it, and the number columns are as wide as their
widest value. The ratings table's header had no rule at all and read as one
more dish; both headers now share one. `pnpm layout` measures 360 as well as
390, and `pnpm dialogs` measures 360 in place of 390, the harder of the two
for the same rules.

## A refusal read as a receipt

Three readers of what a table owes turned a failed request into an answer.
The diner's bill hook replaced a refused poll with `{ orders: [] }`, and an
empty bill is a settled one: the bill vanished from under a diner who owed it,
the settle detection saw it go from owing to nothing, and it asked whether they
wanted a receipt for paying it, then offered them a visit card. The waiter's
settle dialog did the same and said "Esta mesa no debe nada". The sitting hook
took `{ open: false }`, and closed is what makes a phone forget its table.

None of it needs an outage. Every public route is limited per address, and a
restaurant's Wi-Fi is one address, so a busy room is enough. A failed read now
keeps what was known, and the waiter is told the bill could not be loaded and
offered a retry. `pnpm promises` refuses the diner's next poll with a 429 once
the bill is open, and refuses the waiter's read outright, and checks the screen
still tells the truth.

Three more readers did the same with less at stake, and two of them said the
opposite in their own comments. A refused badge poll became `{ badges: {} }`,
which tells a waiter nobody is calling. The bell emptied, under a comment
promising it "shows what it last knew". The promotions picker said "Ninguna
promoción coincide" (no promotion matches) when the list had not loaded at all.
An invariant now forbids a made-up answer anywhere in `src`, whether a
`r.ok ? r.json() : {…}` fallback or a `catch` that empties the state.

The server had its own copy. `staffOpenedBill` refuses a card payment while a
waiter collects the same food, and `splitInProgress` refuses the whole bill
while its shares are being collected. Both dropped the error of their reads, so
a failed read answered "no", the one answer that lets the charge through, even
though the orders read a few lines below them in the same route already refused
on failure. Both throw now, every caller refuses with that route's own 503, and
an invariant counts each guard's reads against its error checks. `/api/session`
answered `{ open: false }` when its reads failed, which a fixed client still
takes as "forget this table", and now it answers 500.

## The tip that arrived twice

Stripe delivers an event at least once, and nothing here dedupes events, so
every write in the settle path has to leave a repeated delivery as it found it.
The whole-table settle marks orders paid with `.eq("paid", false)`, records
payments only for the rows that update returned, and the ledger's unique index
holds a second copy out. The tip does not work like that: it is added to the
first order's tip and total, and it ran on every delivery, including one that
settled nothing. The payment was recorded once, and the order's total and tip
went up each time the event arrived again. The split and the single-order paths
already hung everything on the rows their own update returned. The whole-table
one does now.

The probe that showed it showed a second thing: the payment row said MX$2.50
for a bill Stripe charged MX$7.50. The ledger was written from the orders'
totals before the tip was added to one of them, so a card tip on a whole table
never reached the ledger, and `pnpm money` had never seen one because the seed
has none. The first on production would have turned `money:prod` red with the
ledger short. The tip now goes on an order this delivery settled, and that
order's payment carries it, the way a share of a divided bill always has. The
webhook invariant holds all three: where the tip's order comes from, that the
tip is written to it, and that its payment includes it.

## One address, one room

Every public route is limited per address, and the limits were sized for one
phone. The tracker's route allowed 120 a minute, and its comment said that was
"far above what a real diner's phone asks for", which was true of one phone. A
restaurant's Wi-Fi puts the whole room behind a single public address. The open
tracker asks every five seconds and the menu asks after each order it follows
every fifteen, so thirty diners sitting on the menu with one order each used
the whole 120 before anybody opened a tracker. The split was worse: 60 a
minute, polled every five seconds by every phone in it, so one table of six
dividing its bill on the Wi-Fi ran it out. The screens behind the address then
stopped updating, and the bill's reader showed that as paid (see "A refusal read as a receipt").

The poll intervals live in `src/lib/poll.ts` now, and the three polled routes
size their limits from them with `forTheRoom()`: every phone of
`PHONES_PER_ADDRESS` (30), doubled for the reloads a poll does not count. An
invariant fails when a screen polls one of them at a literal interval or a
route sizes its limit any other way.

## On its way, to nobody

The menu's "Llamar al mesero" marked the call as sent, fired the request and
never looked at the answer, so it said "¡En camino!" for a minute whatever came
back: a rate limit from the room's Wi-Fi, a table that had been deleted, no
connection at all. The bill sheet's "pay at the table" had the same bug and was
fixed with a comment that says so, and the button on the menu, one component
over, was left as it was. It reads the answer now, takes the "on its way" back
and shows the server's sentence when it is refused, and only rests for a
minute once the call has really gone.

The staff side had two more. The waiter bar's "done" took a call off the bar
and then wrote it without looking at the result, so a failed write hid the call
on this phone while it stayed pending on every other one. It goes back on the
bar now, with a line that says it is still waiting. Duplicating a dish said
"Producto duplicado" while the insert that copies its extras went unchecked.
An invariant fails on any request fired with its answer thrown away, and on any
browser write to the database that is never read. The one file excused, the
rating sheet, says why: a lost opinion claims nothing, because the sheet only
closes.

## Offline, according to a server that answered

The orders board moves a ticket as soon as it is tapped and sends the move
after. When the request never got an answer, the move is held in the offline
queue and sent when the connection returns, which is right. But the board
threw on any non-OK answer inside that same `try`, so a move the server had
refused went into the queue too: a 403 from a sign-in that had expired
overnight, a stage that role may not set. The board said "saved, will be sent"
while it was online, the ticket stayed moved on that screen and nowhere else,
and every reconnect sent it again and was refused again, so the banner never
cleared. A refusal now puts the ticket back and shows the server's reason. The
flush drops a queued move the server refused, says how many, and keeps only
the ones a failing server may still take. An invariant holds both.

## Not found, because not read

`fetchTrackedOrder` read one order with `.single()` and dropped the error, so a
read that failed came back as `null`, the same answer as an id that matches
nothing. The tracker page turned that into "not found" for a diner who had just
ordered and paid, and `/api/order-status` answered 404, which the menu's
"track my order" takes as "that order was deleted". It reads with
`maybeSingle()` and throws on a real error now. The page falls through to the
app's "no order was lost, try again" screen, and both routes answer 500, which
every poller treats as "keep what you knew". An invariant keeps the throw in
the reader and forbids a route caller that lets it become a 404.

## Nothing owed, nothing sold

The bills board destructured seven reads as `{ data }` and took a failure as
empty. A failed read of the open orders was "no open tables". A failed read of
the payments against each sitting was "nothing collected yet", so a table
halfway through paying looked as though it owed the whole bill, which the
comment above that read names as the reason it exists: "the floor would see the
whole amount still owing and could take it again". The frozen splits went the
same way, and the settle route does not refuse a table that is dividing its
bill. Analytics did it with the day's sales, the corte and the visit card
numbers: an owner told they had sold nothing, and a drawer counted at zero.

Every one of those reads goes through `unwrap()` now, the helper the menu pages
already used, and a failure renders the error screen, which says no order was
lost and offers a retry. An invariant fails on a `{ data }` destructure on
either screen.

## A Spanish day above an English corte

The dates PR made every date follow the app's language, and its invariant looked
for the two ways a format picks the machine's or the browser's language. It did
not look for a language written into the code. The corte on the analytics page
formatted its day with `DateTimeFormat("es-MX", { weekday, month })`, so an
owner reading the app in English saw "martes, 23 de septiembre de 2026" above
an English corte. It takes `dateLocale(locale)` now. The invariant also fails on
any format that names a day or a month in a fixed language, and lets through
only what is never shown: the kitchen ticket's time in figures, and the
`formatToParts` calls that take a date apart to compute with it.

## Opened three times, skipped the fourth

`pnpm layout` clicks each team dialog and, when nothing opens, prints a dash
and moves on. That is right for a role without the button. In one run the
manager's five menu-editor dialogs opened at 360, 820 and 1280 and did not open
at 390, and the gate still said "Everything reads", because a skip is not a
failure. Whatever the cause, a flaky run or a button the CSS hides at one
breakpoint, a dialog that opens at some widths and not at others was measured
at none of the widths where it mattered. The gate records which widths every
dialog opened at, and fails on one that opened somewhere and not everywhere.
A dialog that does not open is pressed once more after a pause before it is
counted as missed: the first sabotaged run also caught the manager's order
detail missing at 360 for no reason but a click that landed before the page
was ready, and a red over timing is how a gate teaches people to ignore it.

## Offline, for a payment nobody was making

`offline.blocked` says "Necesitas conexión para cobrar, cancelar o aprobar": the
line for the three things that refuse to wait for a connection, because
replaying them twice moves money twice. The visit card screens used it for any
failed request, so a diner making a card with no signal was told they needed a
connection to take a payment, and so was a waiter stamping a card. Those five
places say "Error de red — inténtalo de nuevo" now, and an invariant keeps the
payment line to the settle dialog, the calculator and the board's cancel.

## The rest of the dashboard

#378 made the bills board and the corte refuse a failed read, and its invariant
named those two pages. Six more took a failed read as an empty answer. The
tables page showed no tables, or every table free, because nothing unpaid could
be read. The waiter's pad had no tables to send an order to. Settings called
the printer "never set up", which invites the owner to set it up again and
issues a new token that cuts off the printer that works. The menu editor sent
the manager back to the dashboard as though the menu they opened had been
deleted. The profile page showed no name, and the platform admin's page showed
no restaurants and no logins. Every one goes through `unwrap()` now, and the
invariant reads every dashboard page instead of two, which is how it found the
admin page's four reads, split across lines where a search had missed them.

## A feature that looked broken because it was off

On production no restaurant had switched the visit card on, so no diner was
offered one and no waiter saw "Sellar tarjeta" — which is correct, and which
the owner read as the feature not working, because the Lealtad page never said
the card was off or what switching it on would change. The scanner was on the
page, but only once the card was on; the lookup took a typed code only. The
page opens with a banner that says whether the card is on and what that means,
shows the card a diner gets, reads a card with the camera, and stamps or
redeems a looked-up card. `pnpm promises` opens the page both ways: on, it says
so and keeps the scanner; off, it says so and offers no stamping.

## A card with nothing between its border and its words

`.tt-card` draws a frame and leaves the padding to whoever uses it. Every user
set it inline except the visit card offer, so on the paid-order screen its
sentence and its button sat on the border — in production, unnoticed, because
the layout gate measures overlap and overflow and a box with no padding has
neither. It showed the moment the same offer opened in the menu's sheet. The
offer has its padding; inside the sheet it drops the frame, since the sheet is
already one; and an invariant fails on any `tt-card` with no padding from its
own style or another class.

The same change found the menu's skeleton 41px short of a table's header — it
drew the table as two small pills where the page has a badge and a service
row — so every table menu jumped as it loaded. It is measured equal now at all
four widths, the visit card row included.

## A stamp taken back after its reward

Taking back a stamp checked one thing, that it was today's. A card that reached
its goal with today's stamp, had its reward spent, and then had that stamp taken
back was left at -1: it owed the restaurant a visit, and every screen showed it
as nought, so the diner's next visit also read nought. The undo is now
`loyalty_unstamp()`, which locks the card like the stamp and the redemption do
and refuses a stamp that a reward was spent after. The lookup offers the undo
only where that function would allow it, and an invariant keeps every write
that moves a card's count inside a locked function.

## A paused card's reward, with nowhere to redeem it

Pausing the visit card stops new stamps; a reward a diner already earned is
still theirs — the redeem route honours it, the terms say so, and the diner's
own page tells them so. But every button that redeems was drawn only while the
program was on: "Sellar tarjeta" on Cuentas and at the till, and the lookup on
Lealtad. So the one promise the pause made had no screen that kept it. The
lookup now offers the reward whenever the card is ready, and stamping alone
waits for the program; the off banner says where to go.

## Reds that were the server, not the code

`next dev` replaces its worker when it grows too big, and a long gate run is
what grows it. Whatever the gate had in flight at that moment failed: an
ECONNRESET in the RLS gate that also left a fixture payment behind, so the
money gate went red next; a button the promise sweep never saw render; an
order detail the layout gate could not open. Three in one day, each read as a
fault in the code, each green when run again alone. Every gate that talks to
the dev server now notes the worker's pid when it starts and, at exit, says so
beside its failures when the worker changed, and an invariant keeps a new gate
from skipping it.

## Saved, with nothing in it

Editing a promotion or an icon group replaces its list wholesale: delete the old
rows, insert the new ones. The delete was never checked, and the icon group
checked neither, so an insert that failed after the delete lost the list. The
icon group answered `{ ok: true }` either way; the promotion said it could not
attach its products, but had already dropped the old ones, and stayed active
with none, which is the state its own create path refuses to leave. The diner's
menu drops a combo with no products, so nothing was mis-sold, but the promotion
quietly stopped working. Both routes check their input first (owned products,
no repeated emoji), so reaching the failing insert takes a database fault or a
dish deleted between the check and the write: rare, and silent when it happens.
Each route now reads the old list first, checks the clear, and puts the old
list back if the new one does not land; an icon group that fails as it is
created is removed rather than left empty. An invariant holds both.

## The lint that never read the gates

`pnpm lint` was `next lint`, which reads the app and never the scripts, so the
gates themselves were linted by nothing. `eslint scripts` found 46 warnings.
Forty-one were the verdict idiom `passed ? ok(…) : bad(…)`, which is a statement
on purpose and is now allowed for scripts alone. Four were dead code. One was a
real gap: the attack gate sent the same collection twice and never looked at
the second answer, so a repeat that crashed the route would still have passed
on the ledger alone. It fails on a 5xx now. The lint step covers `scripts/` and
fails on any warning, in the app or the gates.

## Two functions whose search path the caller chose

Supabase's security advisor, run against production after the loyalty
migrations, flagged the two functions that seed a new restaurant's dietary
tags: every other function in the schema fixes its `search_path`, and these
two resolved `dietary_tags` against whatever path the caller had set. Both run
with the caller's own rights and are closed to browser keys, so nothing was
open; they set `search_path = public` now, and an invariant fails on any
function in `schema.sql` that does not name one.

## Before merging anything large

Every step by its exit code. Chain them with `&&`, or run each to a log and read
`$?` — never judge one by the last lines it printed.

1. `npx tsc --noEmit && pnpm lint && pnpm test`
2. `pnpm api` — every route does its job, not only refuses the wrong caller
3. `pnpm smoke` — every page still renders for a signed-in user
4. `pnpm layout` — every page can still be *read*, at 360px, 390px, 820px and 1280px
5. `pnpm promises` — no screen offers what the system then refuses
6. `pnpm dialogs` if you touched a dialog, a shared component or the stylesheet
7. `pnpm money` — the ledger, the orders and the drawer still agree
8. `pnpm attack` — what a signed-in person can do that they should not
9. `pnpm rls` and `pnpm roles` if you touched a table, a policy or a guard
10. `pnpm db:reset` on dev — proves the schema still builds from nothing
11. `pnpm audit --audit-level=high` if a dependency moved, and sort what it finds
    by where the code runs: production, build, or nothing that ships
12. Open the thing you changed in a browser, at 1280px and at 390px, in Spanish
13. If it is money, name every route that touches it and check each one
14. If it changes what we collect, charge, or promise — update the legal text and
    regenerate the PDFs (`node scripts/legal-pdf.mjs`)
15. `pnpm prod:check` and `pnpm smoke:prod` after the merge

Anything a gate creates, it deletes. Count the rows in the tables it touches
before and after a run, and run it three times: a leak capped by a unique index
or a one-open-sitting rule looks stable at one.

## When you find the next one

Add a test to `invariants.spec.ts` and a row to the table above. The list is
only useful because everything on it is something that really happened.
