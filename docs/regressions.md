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

`src/lib/__tests__/schema-drop.spec.ts` keeps `drop.sql` in step with
`schema.sql` — every table, every function, every storage policy. Eight tables
had drifted, which is why `db:reset` failed on production.

`src/lib/__tests__/i18n-parity.spec.ts` keeps both catalogues complete.

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

## Before merging anything large

1. `npx tsc --noEmit && pnpm lint && pnpm test`
2. `pnpm smoke` — every page still renders for a signed-in user
2b. `pnpm layout` — every page can still be *read*, at 390px and 1280px
3. `pnpm db:reset` on dev — proves the schema still builds from nothing
4. Open the thing you changed in a browser, at 1280px and at 390px, in Spanish
5. If it is money, name every route that touches it and check each one
6. If it changes what we collect, charge, or promise — update the legal text and
   regenerate the PDFs (`node scripts/legal-pdf.mjs`)
7. `pnpm prod:check` and `pnpm smoke:prod` after the merge

## When you find the next one

Add a test to `invariants.spec.ts` and a row to the table above. The list is
only useful because everything on it is something that really happened.
