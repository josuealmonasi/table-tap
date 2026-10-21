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
| Pages never receive the restaurant's credentials (security review H1) | The printer token reached every role's browser and survived their removal |
| Staff write only a service request's status; duplicates match within the restaurant (H2) | A member pointed a request at another restaurant's table and silenced its calls |
| Every `.rpc()` call names the arguments of a function in schema.sql (E10) | Proposing a split called the old signature and left the proposer without a seat |
| Links the app sends are built on its own address, never on `Origin` (G3) | A statement email carried a pay link to the caller's site |
| Cashier recovery access and upload authority agree (PR2 review) | Losing POS hid the only upload surface while sign-out still protected held money |
| Deposit identity and display use the same original currency (PR2 review) | A peso deposit was reconciled against a later dollar sale |
| Saved and verified carts compare line multisets (PR2 review) | Verification moved combos first and falsely flagged unchanged mixed carts |
| The manager sees the same saved and current prices approval checks (PR2 review) | Approval showed collected totals without the menu comparison or breakdown |
| Held receipt prices and manager approval agree (PR2) | A cashier could finalize arbitrary offline prices; equal totals concealed changed lines |
| Receiving held money and permission to sell are separate (PR2) | Downgrades, freezes, old receipts and clock errors stranded money on a device |
| A receipt keeps its proven collector, with manager attestation for legacy receipts (PR2) | A manager's login or browser-supplied name could take another drawer's collection |
| The device releases only the exact receipt safely received (PR2) | HTTP success or an amount alone could discard different lines, methods or currencies |
| Original currencies and current-currency reports agree (PR2) | Recovering MXN after a switch to USD relabelled money or mixed incompatible totals |
| Retry decisions use codes and copy uses translations (PR2) | Matching an English error key against translated API copy prevented queueing |
| The actual Stripe Price and the entitlement tier agree (W6 D5) | A portal Price change kept the former metadata tier |
| Ceiling counts and inserts share a restaurant lock (W6 D6) | Concurrent creates each took the last table, menu, dish or staff seat |
| Dish updates and inserts count the same membership (W6 D7) | Add-ons became dishes, or dishes moved restaurants, past the ceiling |
| Frozen management writes and dashboard controls agree (W6 D8) | Direct authenticated menu and table edits, and loyalty edits, remained open |
| Database trial checks and the app clock agree (W6 D9) | A direct write kept an expired local trial's features and ceilings |
| Table orders and waiter calls require dine-in on the server (W6 D10) | A retained table bypassed a downgrade, while old debts still needed paying |
| A trial entitlement and a paid subscription are different (W6 D12) | The current trial tier could not be purchased from its own card |
| Reporting limits and the plan's promise agree (W6 D13) | Unused catalogue windows implied restrictions the plan cards never promised |
| The money gate reads an order on a customer account as the account's, not its table's | An order sent from a table to an account and paid there read as a sitting paid for more than was collected |
| Every board move checks the current live stage, restaurant and write-off flag | A kitchen login revived cancelled, refunded food |
| An approval acts on the amount the manager saw, through guarded routes only | A request showing MX$10 carried a MX$1,000 bill's ids |
| A split freezes its own sitting and closes only with enough collected money | Another table's MX$20 could settle a MX$1,000 bill |
| A closed shift shows cash that arrived after its count, and what the count means now | A late offline sale left a closed shift saying "MX$100 over" for a drawer that was exact |
| Every offline sale with a difference reaches the review, however late it arrived | The review read 14 days by the sale's own date, newest 200: a sale sent 20 days late never appeared |
| A replayed sale keeps the lines it was sold with | Replay repriced every line to today's menu and, after a promotion ended, took stock from the deal instead of its dishes |
| A held sale is recorded in the currency it was charged in, or not at all | A held MX$100 sale replayed after a switch to USD was recorded as US$100 |
| Each held sale is its own key: one tab's save cannot erase another's | Two till tabs saving at once both read the shared list back as safe, and the later write erased the earlier sale |
| A till sale is filed under the restaurant whose screen rang it | Another tab signing in under an open till filed restaurant A's cash as restaurant B's takings |
| A lost till response never deletes committed money (W1.1) | Deleting a settled order orphaned its payment and let replay record the cash again |
| A till repeat proves settlement before the device forgets it (W1.2) | An unpaid shell answered success and erased the held sale |
| A till reference belongs to its restaurant (W1.3) | A cashier could read another restaurant's ticket and silently lose their own sale |
| Collected money is saved before the first send (W1.4) | A hung first request and a tablet restart erased the only sale record |
| The held receipt and server ticket agree (W1.5) | Online settlement used another id and amount, and replay discarded the difference |
| Offline stock and money commit together (W1.6) | A failed stock call was acknowledged and replay could never repair it |
| Credit approval and the kitchen ticket commit together (W1.7) | An account sale reached the pass before the account owed it |
| A cancellation still matches its paid state and account hold under the collection locks | An unpaid cancel won after collection and left no refund obligation (W3-2) |
| Table write-offs refuse accounts, and every account balance excludes waived orders | Written-off account food could still be collected (W3-4) |
| Only the checkout named on the account may clear its hold | A late checkout A lifted checkout B's hold (W3-5) |
| Account checkout settlement locks orders before summing debt | A cancellation or discount committed between the read and the paid flag (W3-6) |
| Table discounts and their approval requests leave account orders alone | Today's discount reached yesterday's customer account (W3-9) |
| Closing an account or changing its ceiling rechecks debt under the charge lock | A concurrent charge left a closed account owing, or passed a lowered ceiling (W3-10) |
| Statements page every unpaid order in a unique order | The 1001st charge vanished from the displayed balance (W3-12) |
| A private offline page belongs to one unexpired user, session and restaurant | The worker kept a pathname-only board after a login redirect, and sign-out never waited for its deletion. A shared tablet could show the previous person's orders |
| A table created after the blanket `revoke … from anon` locks itself down | `rate_limits` shipped world-readable |
| No dialog is rendered inside another dialog | Shipped three times — two focus traps, two Escapes to leave |
| Anything marking an order paid or written off closes the sitting | A sitting that never closes holds the table and the diner forever |
| Every API route has a guard or a rate limit | `order-status` was public and unlimited from the day it was written |
| Nobody hands `paymentOptions` a hardcoded `atTable` | The cart passed `true` always, so paying at the till could never be offered |
| No route parses a request body by hand | Malformed JSON reached a money route as an exception and came back a 500 |
| A time-windowed read of a growing table pages through every row | Analytics said "1000 Pedidos" for a day of 1100: the server stops each read at 1000 rows and says nothing |
| Every diner checkout is card only | No checkout named its payment methods, so Stripe offered whatever the restaurant enabled — OXXO among them — and a voucher's money would be recorded nowhere |
| Every fee we charge Stripe carries the ledger row that reserved it | Summed from orders, the month's fee ceiling missed divided bills, late webhooks, account payments, a fee filed under the month its food was ordered, and two diners at once |
| The month's fee ceiling counts only fees we took, or a checkout still open | It counted abandoned checkouts and refunded cancellations, and orders past the early ceiling paid no fee |
| Every read of the extras each dish offers pages, or is one dish's | Past 1000 links the menu editor read the first thousand, and saving a dish's extras deleted the ones it never saw |
| Server code takes only components from a `"use client"` module | The costs page imported its tab list from a client component and every tab failed to render |
| A cancelled terminal sale leaves the deposit it never reaches | The terminal deposits expected a voided sale, and read the bank short for money correctly given back |
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
| A rate limit keeps no address, and nothing past a day | Every diner's IP address sat in `rate_limits` for ever, named nowhere in the privacy notice |
| A reward already earned can be redeemed on any plan | A restaurant that moved to a tier without the visit card had no screen to honour rewards its diners had earned |
| A failed payment is told on every screen | The terms promise the owner is notified; only the Plan page said so, until the panel froze |
| A lookup that failed is not "no access" | In a database blip an owner was told the account had no restaurant and to create a new one, and every staff route answered "forbidden" |
| A failed read of the promotions is not "no promotions" | Checkout would have charged full price for a deal the menu had shown; the panel told a manager there were none |
| A card settlement that failed before writing makes Stripe send it again | Marking a paid card order failed, the webhook answered 200, and the diner's money sat in Stripe recorded nowhere |
| A bill names every charge in its total | A MX$4.00 salad read "Subtotal MX$4.40": the service charge was inside the subtotal with no line of its own |
| A tier is only an upgrade if it keeps everything | Caja sits above Carta in price and below it in one thing; "the next plan up" by rank would have taken a Carta restaurant's QR ordering away |
| A gate that reads production writes nothing there | `roles:prod` created a live 5% coupon, ZZZ-999, on the demo restaurant and re-sent it on every run |
| Spanish inside an English comment is found, not averaged away | Five lines of Spanish in `schema.sql` passed the English check because the block around them was English |
| No gate waits with `waitForFunction` | `layout:prod` failed all 220 screens before measuring one: production's CSP forbids the `eval` it runs on |
| No gate that writes can reach production before it stops | `api --prod` ran against production five times and left its writes in the live activity log; `promises --prod` pointed the live demo at a Stripe account that does not exist |
| `prod:check` compares each permission by what it is | Policies and functions were compared by name: an unapplied policy body, RLS switched off, or a function handed back to anon would all have passed |
| The attack gate sweeps by its mark, before and after | A worker restart threw the five-at-once collection mid-case and left a MX$200 payment on a sitting with no order |
| A screen money is counted on reads or refuses | A failed read on the bills board showed no open tables, or nothing already collected, so the whole bill looked owing again |
| Menu schedules follow the tier | The schedule editor opened on every tier and saved into the database's refusal below Casa, with only "No se pudo actualizar el menú" to show for it; and a schedule saved on Casa went on closing menus after a move down, by hours the owner could no longer edit. `openMenuIds` now takes the tier's answer as a required argument, so a caller cannot forget it; `pnpm promises` opens the editor on both sides of the line |
| A dialog missing at one width during a worker restart is loaded again first | Five times in one day `pnpm layout` failed a dialog at exactly one width, on a page the change never touched, while the dev server swapped its worker; each opened on the rerun. The open page keeps a bundle that no longer answers, so pressing it again cannot help: the gate now loads the page once more before calling a dialog missing, and says how many needed it |
| An account order is not cancelled while its account is paid online | Stripe charges the orders the online payment was opened for; one cancelled in between was paid for anyway, and the money gate would have found the customer overcharged. `readCancel` refuses it for as long as the account's hold lasts, for the dialog and the route alike |
| A customer account's orders are never a table's | New: an order on an account is delivered and unpaid, so every reader of what a table owes must leave it out or the table is billed for food an account already owes. An invariant fails on any `.eq("paid", false)` without `.is("account_id", null)`, and on either sitting function that forgets; `pnpm attack` charges past the ceiling at once, collects one balance twice at once, and tries the kitchen and another restaurant |
| A crashed attack run leaves its card reader behind | The dev server went down under `pnpm attack`; the demo kept `stripe_account_id = acct_attack`, and the next `pnpm api` sent five "no card reader" cases through to Stripe. The sweep that runs before and after every run now takes it off |
| A visit card's page says what changed and leads back | /rewards had no way back to the menu but the browser's, jumped from the form to the card with nothing in between, and never said that rewards the restaurant added reach a card only when its round ends — nor that the saved picture had gone out of date. `pnpm api` checks the save-again flag both ways and the saved write; `pnpm promises` opens the page for each |
| A coupon lookup that failed is not an unknown code | `findCoupon` read a failed query as "no such code": in a blip a diner was told a code from the restaurant's own flyer did not exist and paid full price, the cart dropped the coupon, and the floor was refused a discount it had just been offered. It throws now, every caller answers "try again", and an invariant fails on a call that does not |
| A feature the tier lacks takes nothing off a sale | Only creating a promotion or coupon asked the plan. The ones saved before a move to Carta or Servicio stayed on the menu and discounted at checkout, the till and the bill, while the owner's screen said they come with a higher plan and the terms say a paid plan's features stop. `pnpm api` refuses a coupon and a combo on Carta, each after a control that passes on the demo's own tier; `pnpm promises` looks for the combo on the menu |
| A read-only gate's probe is refused on its shape, not on data | `roles:prod` probed staff invites with an address that already had an account, because the route checked the address before the role: every run asked production's auth to invite somebody, harmless only while that account stayed confirmed |
| Every dashboard link a role is shown opens for that role | The plan lock offered managers, cashiers and waiters "Ver planes" — the owner's page, which sent them back to the dashboard with no word why. The audit only counted `<button>`s, and the link was an `<a>` |
| A login with no screen on its tier lands on a sentence | A kitchen or waiter login kept through a move down to Caja bounced between `/dashboard` and the board forever: each sent it to the other, and the person saw an empty frame. `pnpm promises` opens it as the kitchen |
| The docs do not count what the code decides | `CLAUDE.md` said the API gate called 34 routes and the spec said 48; there were 61, and the dialog count was as far behind. A number in prose is right the day it is written. An invariant fails on a doc that counts routes, dialogs, overlays, tables, screens or pages, in digits or in words |
| A visit card is made only from inside the restaurant | `POST /api/loyalty/card` took the restaurant's id alone, which is printed on every QR, so anybody could fill an owner's program with cards nobody carries. The page now hands out a signed visit pass for its table, order or the counter; one pass makes one card, each place has a ceiling. `pnpm api` makes a card from each page and sends one pass twice, none, and another restaurant's; an invariant keeps the checks before the insert |
| A full room behind one Wi-Fi is not one phone | Every diner write was limited per address and sized for one phone, so a busy room shared ten payments a minute between all its tables. Each table now has that allowance behind each address, and the address a ceiling ten tables high, counted first. A unit test fills a room and invents tables; an invariant fails on a public write that takes a table and does not count it |
| A table is settled in one write | "Pagó en efectivo" marked the orders paid and then wrote the ledger; a failed second write left a bill paid with no money behind it, the corte short by that bill, and nothing could repair it because every path guards on `paid = false`. Closing a bill paid in parts ignored its write's error and answered "settled". Both go through `settle_orders()`: orders and payments together or not at all. `pnpm attack` settles one table five times at once; the API case checks the order and its one payment; an invariant keeps both routes on the function |
| A card payment is recorded with the orders it paid | The webhook marked orders paid and then wrote the ledger, and claimed a divided bill's share and then recorded it; a failed second write left the diner's money recorded nowhere, and Stripe's repeat found nothing left to do. A failed close of a divided bill was never retried. `settle_card_orders()` and `settle_split_share()` do each as one write; unit tests cover a failure, a repeat and the tip; invariants keep the webhook off the ledger outside them |
| A till sale and its money are one write | The till inserted the order already paid and then wrote the ledger; a failed second write was a sale in the day's orders with nothing in the corte. The sale now goes in as `pending_payment` and `settle_sale()` makes it paid, gives it its status and records the money at once; on failure the sale is deleted and its stock returned. The API case checks the sale has exactly its payment; an invariant keeps the till on the function |
| A card payment on a bill already paid is kept for refund | A waiter took cash while the diner was on Stripe's page; the webhook's update matched nothing and the card money was recorded nowhere — the diner paid twice and nobody was told. `settle_card_orders()` now compares what Stripe charged with what it recorded and keeps the difference in `refunds_due`, out of the ledger, with a notification. `pnpm attack` pays a table in cash, then delivers the card payment twice, and expects one refund of the full amount and one notification |
| Nothing is cut off at the left edge of a phone | The bell's panel hung from the bell, which sits left of the account button, so at 375px it started nine pixels off screen. Every gate passed: the only sideways check was the page scrolling, and content off the LEFT never scrolls. The audit now flags a box that starts left of the window and ends inside it, unless a scrolling container explains it; the panel anchors to the bar on phones |
| Nothing is cut off at the left edge of a phone | The bell's panel hung from the bell, which sits left of the account button, so at 375px it started nine pixels off screen. Every gate passed: the only sideways check was the page scrolling, and content off the LEFT never scrolls. The audit now flags a box that starts left of the window and ends inside it, unless a scrolling container explains it; the panel anchors to the bar on phones. The same check, on its first run, found the menu editor's bulk bar 26px off both edges at 360px and covering the tab bar; it wraps above the tab bar now |
| A failed write in the menu editor is said in the owner's language | Reordering extras reported its failure as `"reorder extras"` where every other write passes a message key, so a failed reorder toasted a raw English phrase to a Spanish owner. An invariant now reads every key the editor reports and fails on one missing from either language |
| A deal's quantities stay on their own dishes | The promotions list looked each dish up, dropped the deleted ones, then read quantities by position: a deal of three tacos and a water whose first dish had been deleted read "Taco + 3× Agua". `promotionItemNames` pairs each dish with its own quantity, and a test deletes one |
| A refused checkout gives back the coupon it claimed | The diner's checkout checked the table after it had reserved the coupon's use, and answered "table not found" without handing it back. A code with a limit could be spent down to nothing by asking for a table that is not the restaurant's, and a diner whose table was deleted while they ordered lost a use quietly. The table is checked before anything is reserved now, and the api gate sends a coupon with a stranger's table and counts the uses before and after |
| A checkout that crashes gives back what it claimed | Every refusal in the diner's checkout handed back the coupon's use and the stock by hand, but an error nobody expected — a dropped connection, a thrown query — went to the catch-all, which gave back nothing: the use stayed spent and the portions stayed sold to an order that never existed. `checkoutHold` now holds what the request has claimed and gives it back exactly once, from every exit, until the kitchen or Stripe's expiry owns it. A route test makes each step throw in turn and counts what came back |
| A double payment goes back with our fee, and is seen to go back | A card payment that landed on a bill already collected was flagged in the bell, which told the owner to refund it in Stripe. Nothing could mark it done, so it stayed "waiting" forever, and a refund made in Stripe kept our commission on a sale that never happened. Cuentas abiertas now lists each one with a Reembolsar button: Stripe refunds it first, with `refund_application_fee`, and only then is the row marked. A retry reuses the refund Stripe already made. Unit tests sabotage the fee, the reuse and the log line; the api gate checks a refused refund stays owed; the attack gate checks the kitchen, a waiter, nobody and another restaurant's manager are all refused |
| A restaurant can connect Stripe | "Conectar Stripe" asked Stripe for the `recipient` configuration a destination charge needs, though every diner payment is a direct charge; once Stripe's preview API moved `payouts` into `merchant`, it refused the whole account, so no restaurant could connect at all. Status also waited on `recipient` transfers, so even a finished onboarding would never have offered cards. The api gate had accepted 502 from this route as healthy. Now: `merchant` only, cards on `card_payments` active, the api gate demands a real test-mode onboarding link, and an invariant ties Connect to how the routes charge |
| A photo taken on a phone can be uploaded from that phone | Reported by a customer: on mobile a dish photo could be removed but never added. The 5 MB storage limit was checked against the ORIGINAL file, before the resize that shrinks every photo to 800px, so a phone camera's 6–15 MB photo was refused on the phone that took it. Safari, which cannot encode WebP, also uploaded a PNG labelled as WebP. The limit now applies to the resized photo (originals up to 40 MB), Safari stores a real JPEG, and the bucket accepts both; reproduced with a 13 MB photo at 390px before and after |
| A locked switch says which plan unlocks it | Reported by a customer on the free plan: "pay at the end" would not switch on and nothing said why — the only explanation was a grey line under the switch naming no plan. It now shows the same lock the rest of the panel uses, under the switch: "Cobrar al final o en la caja viene con Servicio", with Ver planes. The plan named is the cheapest that includes it (`cheapestWith`), not a fixed word |
| Only the platform admin moves a restaurant's plan, and never over a live subscription | New on 8 October 2026 at a customer's request. The api gate signs in as the platform admin (failing loudly without `PLATFORM_ADMIN_PASSWORD`, rather than being refused and reading that as working) and moves a plan, and checks an owner sending the same request is refused with the plan unchanged. Unit tests refuse an unknown plan, a live or unreadable subscription, and log every move |
| A form in a dialog can be typed into | Reported by the user: creating a login from the admin panel, every field but email took one character and then the cursor jumped back to email. `Modal` moved focus to its first field in an effect that listed `onClose` as a dependency, and callers pass a new arrow on every render — so every keystroke re-ran it. Every form in every dialog had it; email looked fine only because it was the first field. `onClose` is read from a ref now and focus moves in when the dialog opens. `pnpm dialogs` now types into each dialog's fields and each page's own, and fails when the cursor leaves or the text does not arrive |
| A platform admin's plan move survives a late Stripe event | Found reviewing #464 against the admin plan move: a restaurant whose subscription was cancelled can be moved by the admin, and Stripe re-delivers that cancellation for days — the sync wrote the free plan back over the move. The move now unlinks the finished subscription and bumps `subscription_sync_revision`, and `applySubscription` ignores a finished subscription the restaurant no longer has; a new subscription with nothing linked still records |
| Every write of a restaurant's plan is made over the sync revision it read | Found in the audit loop, the day the admin plan move shipped: the Stripe sync wrote the plan only over the `subscription_sync_revision` it had read, but the admin move and the end of a trial wrote unconditionally. An owner whose subscription webhook landed between either one's read and write had a live, paid subscription unlinked (the move) or was dropped to the free tier (the trial ending, whose `plan_status = 'trialing'` guard also matched a Stripe trial) — paying Stripe for a plan the restaurant no longer had until the next billing event. Both now write over the revision they read and bump it; the trial ending skips a restaurant Stripe bills and re-reads when it loses. `admin-plan.spec.ts`, `plan-server.spec.ts`, and an invariant that every `restaurants` update setting `plan`, `plan_status` or `stripe_subscription_id` moves the revision and requires the one it read |
| A restaurant takes cards as soon as Stripe says it can | Found in the audit loop: `stripe_charges_enabled` was written only when the owner opened Settings (`/api/connect/status`). Stripe usually finishes reviewing an account after the owner has left onboarding, so a restaurant Stripe had approved offered its diners no card payment until somebody opened that screen again — and one Stripe later restricted went on offering cards every charge refused. The Connect webhook now handles `account.updated` by reading the account from Stripe again (never from the event), and fails out loud so Stripe retries a write that did not land. `stripe-connect.spec.ts` and an invariant that the Connect endpoint follows `account.updated` |
| A card payment's hold on a customer account outlives a dead checkout's late expiry | Found in the audit loop. Opening an account checkout holds the account for 35 minutes (its Stripe session dies at 30). Once the hold lapsed a new checkout could open while the old one was still `open`, and the old one's `checkout.session.expired` arriving late — Stripe retries for days — lifted the NEW checkout's hold: the till could collect the account in cash while its customer was paying it by card, and the card settlement then records money for orders already paid. Reproduced on dev (hold null, till collected: 200). Opening a checkout now closes the account's dead open ones, and the release is one function (`account_checkout_release`) that touches only an open checkout. `pnpm attack` replays it through the real functions and the till |
| A customer account paid twice is a refund due, like a table | Found in the audit loop, next to the late-expiry fix: `settle_card_orders` keeps a card payment that lands on a settled table as a refund due and rings the bell, but `account_checkout_settle` booked the whole card payment even when the till had collected the tab after the hold ran out (a webhook arriving late) — the customer paid twice, the ledger said the account paid double, and nobody was told. It now books only what was still owed and keeps the rest as a refund due with the account's name, once. `pnpm attack` replays it (cash, then the card webhook twice) and an invariant holds the function to the table's rule |

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

The same advisor's performance pass flagged two policies — the staff
membership check that runs on every dashboard request, and a user's own
profile — for calling `auth.uid()` bare, which is evaluated once per row.
Wrapped in `(select auth.uid())` it means the same and is evaluated once; an
invariant keeps every policy that way.

## English on a Spanish menu, from a template literal

When an extra sold out between adding it and paying, the cart dropped it and
told the diner "Guacamole is no longer available, so we removed it from your
order. Review and pay again." — in English, whatever the menu's language,
because the sentence was a template literal handed straight to `setNotice`.
The i18n check proves every key resolves and the English-code check looks for
Spanish in code; English words written on screen passed both. The notice goes
through `t("cart.extrasRemoved")` now, and an invariant fails on any notice,
toast or error set from literal words.

## A gate that could not run where it mattered

`pnpm layout --prod` reported 220 problems, and every one was the same
sentence: evaluating a string as JavaScript violates the Content Security
Policy. It had been that way since the nonce policy landed on 2026-09-10
(#306), two weeks before anyone ran it against production. The layout gate
waited for each page to settle with Playwright's `waitForFunction`, which runs
its predicate through `eval` inside the page — a function as much as a string.
Development allows `unsafe-eval` because the hot reloader needs it; production
does not, so the gate passed every day against the dev server and measured
nothing on the deployed site. It polls with `evaluate` now, which goes through
the DevTools protocol and leaves the page under the policy it ships with.
Bypassing the CSP instead would have measured a page no diner ever sees. An
invariant fails on any gate that calls `waitForFunction`.

## Gates that would have written to production

Three gates took `--prod` and wrote to whatever they were pointed at.
`api:prod` — which this guide recommended — plants tables, a sitting, orders
and three payments, then stamps cards, redeems rewards and opens checkouts,
because every case does its job for real. It was run against production five
times, on 2026-09-10 and 2026-09-15. Its teardown removed what it planted, but
the activity log outlives the rows it describes: six entries in the live demo's
log still read `note=apicheck`, a waiter asking to write off a walkout and a
manager writing one off. `rls --prod` plants an icon group in a real
restaurant, and its write cases ask for a real restaurant's table to be settled
in cash and one of its rows deleted — refused while every guard holds, done for
real the day one does not. `promises --prod` flips the live demo's plan and
`accepting_orders`, points it at a Stripe account called `acct_promise_audit`
with charges on, and inserts a paid order; the restore runs in a `finally`, and
a run killed halfway never reaches it. Only `attack` refused, and it printed
"Skipped" and exited 0, so a chain of `&&` read it as a pass.

All three now stop in `refuseProduction()` before they load an env file, and
exit 1; `promises --prod` runs its read-only sweeps and skips the states. An
invariant finds every script that can reach production and writes — through
supabase-js, or by calling a local module that does — and fails unless a stop
comes before the first write. Pointed at the old versions, it named all three.

## Production's permissions, compared by name

`prod:check` compared development and production by the names of their
policies and functions. The #392 rewrite of two policies to
`(select auth.uid())` kept both names, so a production that never got it would
have passed; so would a table with RLS switched off, a function that lost its
pinned `search_path`, a revoked function handed back to anon, and a function
whose body the deployed code had moved past. It compares what each one is now:
every policy's command, roles, `using` and `check`; every table's RLS flags;
what `anon` and `authenticated` may read and write; every function's owner
rights, search path, who may execute it, and an md5 of its source. Run against
both databases the day it was written, all 34 tables, 41 policies, 880 grants
and 26 functions agreed. With production doctored in memory — #392 unapplied,
one table's RLS off, `loyalty_redeem` executable by anon — it named all three
and exited 1.

## Litter from a case that threw

The dev server replaced its worker while `pnpm attack` fired five collections
at one table at once. One request died with it, `Promise.all` threw, and the
case never reached its own tidy-up. The gate's last `finally` removed only the
orders it had marked and the money on its main sitting, so the race's table,
its sitting and a MX$200 cash payment with no order stayed in the demo. The
next `pnpm money` would have reported a sitting holding MX$200 against nothing:
a real-looking overpayment made by the test. The last-portion race had the same
gap with a real dish, left at a stock of one.

Every table the gate makes carries its mark in the label, and `sweep()` finds
the sittings, orders, payments, splits and log lines from there. It runs before
anything is planted, so a run killed outright is cleaned by the next one, and
again in the last `finally`, which also puts the raced dish back. An invariant
fails on a table made without the mark, or a sweep missing from either end.

## A coupon the roles check left on the live demo

Production's database log showed a coupon refused as a duplicate, twice, in a
window where only the checks that read production were running. `roles:prod`
checks who may use each route by sending the request, and it sent real bodies:
an allowed role got through for real. On 2026-09-10 it created ZZZ-999, 5% off
and active, on the live demo restaurant, where any diner could use it, and
re-sent it on every run after. The same list set `accepting_orders` to true,
which switches ordering back on for a restaurant that had paused it; marked
every notification read; and asked Supabase to invite an address at a
stranger's domain. The previous fix listed `roles:prod` among the checks that
only read.

Each write is now probed with a body the route turns down only after it has
checked the role: nothing to mark, no field to change, a code in the wrong
shape, an address that already has an account. `passes` names the one answer
an allowed role may get, and any other — a 2xx above all — fails the run.
Against production, every allowed role got exactly its answer and nothing was
written. The layout and promise sweeps now also hold every write in the
browser when they run against production, the way the dialog sweep always
has, and list what they held. Invariants fail on a write probe with no
`passes`, and on a browser context in a production-capable gate that does not
hold writes. ZZZ-999 is still on the live demo: removing it is the owner's
call.

## Spanish that hid inside English comments

The English check scored each comment block as a whole, so Spanish written
into an English block was outvoted by its neighbours. Five lines in
`schema.sql` explaining why the `timezone` column is granted to diners, a
sentence in the page guard, a clause in the discount-options route, the label
row of the bills skeleton, and a sentence in the icon-group hook that switched
language halfway through all passed. A lower threshold found them; the fix
does not lower the threshold. It looks for a run of words with no English-only
word in it and three Spanish-only ones, once quoted text is taken out, since an
English comment may quote the Spanish UI it describes. Across the repo that
flags exactly the five and nothing else, and each file put back as it was
fails the check.

## Forbidden, because the database was slow

After #401 merged, `roles:prod` failed once: the owner's staff probe was
answered 403, and twelve repeats all gave the declared 400. The request never
reached the invite, and a production read timed out with a 504 in the same
minute, so the refusal came from the checks before it. Every one of those
lookups read a failed query as "nobody":

- `getMembership` never looked at its errors, so a timeout meant "a member of
  nothing". An owner opening the dashboard was told the account had no
  restaurant and to contact support or create a new account; every guarded
  page sent them to `/login`; and all 33 routes behind `acting…()` answered
  "forbidden", a waiter collecting cash included.
- `getPlatformAdmin` used `.single()`, which reports "no row" as an error, so
  it could not tell "not an admin" from "could not ask" (and wrote a 406 into
  the database log on every staff request).
- `currentUser` read an auth server that did not answer as "signed out".
- `getPlan` read a failure as "no plan", which the plan guards answer with
  "forbidden": a restaurant on the right plan refused its own features.

Each now throws on a failed read and returns null only for a real absence: no
session, no row, or an id that is not one. A page reaches the error screen
and its retry; a route answers 500, which the client words as "try again".
Nothing is granted either way. The root layout catches the failure for the
navbar alone, and the page asks again (both are cached per request) and gets
the same error, so it lands on that screen rather than on Next's bare default.
Unit tests cover the answer and the failure for all four; against `main`'s
files, exactly the failure cases fail.

## Prices and a menu from reads that failed

The diner's menu has an `unwrap` for exactly this — a failed read throws and
reaches "try again", a missing row is an answer — and three of its reads did
not go through it. A failed menus read was "this restaurant has no menus", a
blank menu for a diner holding a valid QR; a failed time zone read opened the
menus by Mexico City's clock; and a failed card-readiness read took card
payment off the menu without a word. They go through `unwrap` now.

`fetchPromotions` read a failure as no promotions, and checkout, the waiter's
order and the till all price a cart against it: a blip would have charged
full price for a two-for-one the menu had just shown. It throws now, so the
routes answer "try again" and nothing is charged. On the dashboard the same
read said "No promotions yet. Create one below", and a manager who believed it
would have set up again the deals that already exist; the panel says it could
not load them and offers to try again, and a promise case refuses the read and
requires exactly that.

## Card money that a failed write left in Stripe

The Stripe webhook answers 200 unless settling throws, and Stripe only sends
an event again after a failure. Every settling path read a failed write as
"nothing to settle": marking a pay-now order or a table's bill paid, reading
a divided bill, marking one diner's share paid. The diner's money was in
Stripe, recorded nowhere, the order still owed, and nothing would ever ask
again. Each of those is the first write of its path, so when it fails nothing
has been written: it throws now, and the `paid = false` / `paid_at is null`
guards make Stripe's retry safe.

The divided bill had a worse one. After a share was paid, the unpaid shares
were counted and `(count ?? 0) === 0` closed the pot — so a count that failed
read as zero, marked every order the table divided as paid, and closed the
split while other diners' shares were still owed: food out, unpaid. Only a
count that came back zero closes it now; a failed one leaves the bill open
and part-paid, which is the truth.

What this does not fix is decision 1: a failure AFTER the first write — the
order marked paid, the payment row not written — still cannot be retried,
because the guard then matches nothing. That needs one transaction per
settlement. Unit tests with a recording fake database cover each path; against
`main`'s file, the five failure cases fail and the two normal ones pass.

## MX$4.00 of salad, MX$4.40 of subtotal

The owner opened a diner's bill on the live demo: "1× Side Salad MX$4.00",
then "Subtotal MX$4.40, Total MX$4.40", and nothing in between. Both orders
on that table were placed while the 10% service charge was on, so each stored
its fee; the bill summed the orders' totals, called the sum a subtotal, and
passed a service charge of zero to the totals card. The money was right —
it is what the orders were priced at and what the waiter would collect — but
a total that does not add up from the lines above it reads as a wrong price,
and to a diner it is one.

`tableBill` carries each side's service charge and any tip already on its
orders, and the bill shows the dishes, the discount, the service (with the
percentage it was charged at when that is a round number) and the tip as their
own lines, adding up to exactly what the button charges. The service line
appears whenever there is a charge, including one from before the restaurant
switched it off.

And switching it off now reaches the bills that are open. The owner's word —
no service charge — applies to what nobody has started paying, and it only
ever lowers: switching it on never adds to an order the diner already saw the
price of. What is already promised is left alone (see the spec's bill
section), including a card checkout still open, which is why `/api/bill/pay`
marks its orders before the Stripe session exists and the session now expires
in 30 minutes. An api case switches it off over a planted bill and reads what
the bill then owes; unit tests cover the arithmetic and every exclusion.

## The visit card, as a chip

The owner found the visit card's row on the menu too big: a full-width band
between the service buttons and the order banners, pushing the dishes down for
something a diner taps once. It is a chip beside the table's badge now, 28px
tall so a thumb finds it, naming the card; the rewards are in the sheet it
opens and in its accessible name. The skeleton holds the same line — badge and
chip together — instead of a 36px row that no longer exists, and the promise
case that read the rewards off the row opens the chip and reads them there.

## Two ways to the same list of menus

Hovering the Menús tab unfolded a panel listing the restaurant's menus — the
same list the page it opens already is. The owner found it confusing: a panel
that appeared under the pointer on the way to somewhere else, offering the
place the click was about to go anyway. The tab is one place now, like every
other tab, and `MenusMenu` is gone with its styles and its two strings.

## Caja, and the ladder that stopped being a line

Caja is the register on its own — cash or the restaurant's own terminal, tips,
receipts, promotions, inventory and the visit card, and nothing through the
diner's phone. Building it found three things that had only worked because
every tier contained the one below it. Two flags in `schema.sql` were set by
`rank` (`allows_menu_schedules = rank >= 2`, `allows_deferred_payment = rank >=
1`), so inserting a tier at rank 1 would have handed Servicio menu schedules
and Caja pay-later on the next deploy; they name their tiers now. `nextPlan`
and `cheapestWith` took the next rank up, which from Carta would have been Caja
— an "upgrade" that takes QR ordering away; they only name a tier that keeps
everything (`keepsEverything`). And the visit card was Casa-and-up, so Caja
having it made Servicio a step down from Caja; Servicio has it now, on the
owner's decision. Tests pin all three, and promise cases open Caja's menu and
its till.

## Addresses the privacy notice never mentioned

An audit of the app against its own terms and privacy notice found that every
rate limit keyed on the caller's IP address — `bill:189.x.x.x`,
`checkout:189.x.x.x` — and that nothing ever deleted a row: production held
137, the oldest six weeks old. The notice lists every kind of data the app
keeps, and addresses were not on it, nor in what it says about how long
anything is kept.

The limiter only needs to know that two requests came from the same place
within a minute. `clientKey` answers that with an HMAC of the address under
the server's secret, so the same address gives the same key and the key does
not give back the address; `rate_limit_hit` sweeps windows older than a day;
and the notice now says what is kept, why, and for how long, with the terms
and notice versioned 2026-09-29 and their PDFs regenerated. The same reading
found the staff line short too: it named an email and a role, while a login
can record a name on its profile and the activity log keeps who did each
operation — both are in the notice now. A test fails if the
key contains any part of the address, if anything else reads a request's
address, or if the sweep or the sentence goes.

## A promise with no screen behind it

The terms say a visit-card reward a diner has earned is honoured even if the
restaurant pauses its program or changes plan. The pause was kept: a paused
program still redeems. The change of plan was not, although the route never
checked the plan — on a tier without the card the loyalty page was nothing but
a lock, and the bills screen hides its stamp button, so no screen could redeem
anything. The audit that read the terms against the app found it.

A restaurant that ran the card keeps, under the lock, the card lookup in the
mode a paused program uses: it redeems and does not stamp. A promise case
switches to a tier without the card and requires the scan button and the
sentence that says why it is there.

## Told, according to a page nobody opens

The terms say that when a subscription payment fails, the owner is notified
and it is retried. Stripe retries; the notice was one line on the Plan page.
An owner who did not happen to open it learned of the failure when the panel
froze. The dashboard's banner, which already says when it is read-only, now
also says when a payment is being retried — to the owner, on every screen,
with the link to fix it — and a promise case sets `past_due` and requires it.

## Missing at 360, because the site had just woken up

`layout:prod` run straight after four deploys reported seven of the owner's
dialogs as opening at 390, 820 and 1280px but not at 360px. At 360px, on a
warm page a minute later, every one of them opened. The owner's screens are
the first the run opens and 360px is its first width, so those pages were the
cold ones, and one pause of 1.5s before the retry was not enough for them to
hydrate. The gate now tries twice more, after 1.5s and then 3s, before calling
a dialog missing. A dialog that really does not open still fails, just
seconds later.

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

**Checkout and stock recovery must be repeatable.** Two expiry deliveries used
to return the same coupon and portions twice. A cancellation could become final
before its stock return failed, leaving no retry. `abandon_checkout` and
`cancel_order` now own the guarded transaction, and new orders return the exact
reservation taken at checkout. A plan downgrade, newly tracked item, or tracking
restart cannot invent or strand portions. `pnpm attack` includes stock tests
with concurrent expiry/cancel calls, a forced database return failure, and an
orphan followed by a late insert. Its fixtures are isolated and removed.
`pnpm money` reports outstanding orphan returns; `db:recover-stock` repairs them
without touching reservations attached to orders.

**A webhook retry finishes the whole payment.** A split's share could commit
before settling that diner's later orders failed. The retry saw an already-paid
share and skipped those orders forever. `checkout-settle.spec.ts` reproduces
that interruption and verifies the retry reaches the remaining orders. Count,
fee and final-state errors also request a retry.

**A subscription event is a signal to read current state.** Failed writes used
to be logged and acknowledged, and older events could overwrite a newer plan.
`subscription-sync.spec.ts` covers failed reads/writes, stale snapshots, replaced
subscriptions, and conflicting revisions. Stripe's current object plus a
conditional local revision write prevents a stale worker from winning.

## A refused pickup that still said delivered

The till removed a ready pickup before asking the server to complete it, then
showed the delivered message even when that request failed. A cashier saw an
error and a success together, with no pickup left to retry. A browser probe
that refused the request reproduced both symptoms.

`useCounterPickup` now removes only orders the server accepted and reports
success only when every order was accepted. Refused or offline handovers stay
visible. Hook tests cover success, a refusal, a network failure and a partly
accepted handover; the browser probe confirms the refused pickup stays on the
till without a delivered message.


## A waste response that told the kitchen its cost

The staff waste screen hid costs, but recording waste returned the calculated
cost in its API response. A kitchen or cashier login could inspect that answer
and recover an ingredient's unit price despite the costs page and tables being
restricted to management. The mutation response only needs the new entry's id;
its private cost stays in the server's record for the owner's view.

The API cases for kitchen ingredient waste and cashier product waste now
require that the response has no cost field. The kitchen case still reads the
stored record with the service key and verifies its cost, so hiding the answer
cannot silently stop recording it.

## A server page that read a browser-only tab list

The expanded costs page imported its tab list from a `use client` component.
Next.js exposes that export to the server as a client reference, not an array,
so calling `includes` failed before any cost panel rendered. Shared tab values
now live in a plain module that both the page and its client frame can import.
The live roles check opens the costs page as owner and manager; the Phase 2
browser walk also opens every new tab at phone and desktop sizes.
An invariant now parses every server file's imports and fails on any
value, function or hook (anything not PascalCase) taken from a `use client`
module; type imports are erased and pass.

## Reports that stopped at the thousandth row

PostgREST returns at most 1000 rows per request on Supabase and says nothing
when it stops. Analytics read a period's paid orders in one request, so a day
with 1100 paid orders showed "1000 Pedidos" and MX$1,000.00 against MX$1,100.00
in the database — reproduced on dev with planted orders. The same shape sat
under today's corte and each shift's expected cash (the figure a blind count
is compared with), the cashier's own takings on the bills screen, every
customer account's balance, the visit card's numbers (whose `.limit(10000)`
changed nothing: the cap wins), the month's platform fees behind the fee
ceiling, and the money gate itself, which would have reconciled only the
first thousand payments and reported success. Each now pages through
`everyRow`, and an invariant fails on any time-windowed read of a growing
table that neither pages, says how few rows it wants, nor only counts.

## A voided terminal sale the bank was still expected to pay

Cancelling a sale paid on the restaurant's own terminal asks a person to void
it there, and keeps its payment row — the money did arrive. The terminal's
deposits read every card payment without Stripe, cancelled or not, so a sale
voided minutes after it was rung stayed in the day's expected deposit:
reproduced on dev, a MX$9.90 sale cancelled with "devolver MX$9.90 en la
terminal" still read "1 cobros, MX$9.90 · MX$9.55 el lun 19 de oct", which
turns late, then short, for money that was correctly given back. The corte
had it right all along: it takes a handback out of the drawer the day it is
handed back. `cancel_order` now stamps `orders.cancelled_at`; a sale voided
the day it was taken counts nowhere, and one voided later comes out of the
next deposit from that day on. `terminal.spec.ts` covers each case, and fails
on all four with the void ignored.

The same read passed every order id it had paid in one `in` filter. Dev
refuses that request somewhere between 300 and 500 ids, about 18 KB of URL,
which a café taking thirty terminal cards a day reaches inside the 14 days.
The order now rides along on the payment through its foreign key.

## Extras the editor never saw, deleted when a dish was saved

`item_addons` grows with the menu, not the clock: dishes times extras. Both the
menu editor and the diner's menu read it in one request, with every dish's id
in the URL. Reproduced on dev with every Demo extra on every dish (1056
links): the editor's read, as the owner, came back with exactly 1000; three
dishes came back short, two with no extras at all; and unticking one extra on
Grilled Salmon and saving left it with 15 of 24 — the editor replaces a dish's
whole set with what it holds, so eight extras nobody touched were deleted.
The editor also swallowed a failed read and showed no extras at all, which a
save would then make true. Past a few hundred dishes the URL itself is refused
(dev refuses an `in` filter between 300 and 500 uuids).

`everyRowIn` (`src/lib/paged.ts`) sends the ids in slices of 150 and pages
each slice; both reads use it, in each link's saved order. The editor throws
on a failed read, stays locked, and says so. In the same seeded state the
editor now ticks all 12 of Grilled Salmon's menu's extras where the old read
held 7, and the diner is offered all 12. An invariant fails on any read of
`item_addons` that neither pages nor is one dish's; it named `menu-data.ts`
when the old read was put back.

## A fee ceiling reached with fees we never had

Each plan promises "never more than X" in per-order fees a month, and the
ceiling is summed from `orders.platform_fee`. The fee is written on the order
when the checkout opens, before the diner pays — and the sum took every order
carrying one. An abandoned checkout stays behind until Stripe's expiry event
deletes it, and production has no Connect webhook yet, so there it stays for
ever; a sale cancelled after it was paid gets its fee back with the refund.
Both counted. Reproduced on dev by planting one of each at MX$0.75: the
month's sum rose by 150 cents for money that never arrived, and orders past
the early ceiling would have paid no fee. The costs screen already summed
only paid, uncancelled orders, so the two disagreed. `feeCounts` now takes a
fee when the order was paid and not cancelled, or while its checkout is still
open (`CHECKOUT_HOLD_MINUTES`) — two diners paying at once must never both be
priced under a ceiling only one of them fits under. `fee-month.spec.ts`
covers each case; the same probe now adds nothing.

The first version of that fix dropped every cancelled sale's fee, which was
right only for a diner's own checkout. A table's bill pays one fee for the
whole sitting, written on its first order, and cancelling that order refunds
only its share: dropping the whole fee counted the month short, the one
direction that could charge a restaurant past its ceiling. A cancelled fee
now stops counting only when its charge is known to have covered that order
alone; a shared charge, or one never written on the order (a table's bill
settles without one), still counts. Probed on dev: a cancelled table-bill fee
order and a cancelled own checkout at MX$0.75 each now add 75 cents, the
table's.

## The fee ceiling, reviewed: kept in a ledger of its own

A second review (Codex, at the user's request) of the two fixes above found
the ceiling could still count short — the direction that charges a restaurant
past "never more than X" — in five more ways, all because it was summed from
`orders.platform_fee`, which records neither when a charge happened, whether
it went through, nor how much of it went back:

- a paid checkout whose webhook was late read as abandoned after 35 minutes;
- a divided bill's fee, written on an order that stays unpaid until the last
  share lands, was not counted at all;
- two checkouts reading the month at once both fit under one ceiling, a table
  bill's fee was written only on settlement and an account's lived in
  `account_checkouts`, and two shares opened at once each charged the fee;
- a fee was filed under the month its food was ordered, so a September order
  paid in October never counted in October;
- a table bill's fee write ignored its error.

The ceiling is now its own ledger, `platform_fees`, one row per charge. Every
checkout reserves its fee there before Stripe is asked, under a lock per
restaurant; the session carries the row as `fee_id`; the webhook takes it,
expiry releases it, and refunds record the share that went back, once per
refund id. Probed on dev: twelve reservations at once with room for two —
two fit; a refund retried counts once; a taken fee cannot be released. `pnpm
attack` runs those, the api gate checks that a checkout Stripe refuses gives
its fee back, and an invariant fails on any Stripe session that charges our
fee without its `fee_id`. `src/lib/fee-month.ts` and its order-based rules
are gone.

Codex reviewed that ledger too (#497) and found four more, fixed in the same PR:

- **A divided bill's share could be paid into another restaurant's Stripe
  account.** The split was looked up by its id and sitting, never tied to the
  restaurant whose account took the money: a diner holding a real share could
  name another restaurant that takes cards, pay it there, and have the first
  restaurant's share marked paid with none of the money. The split, its
  sitting and the table now have to belong to the restaurant asked; an api
  case pays through another restaurant and expects 403 and no fee reserved.
- A failed Stripe call released its fee even when Stripe's answer never
  arrived — and Stripe says such a session may exist. Released now only on an
  outright refusal (a 4xx).
- A session opened before the ledger had no `fee_id`, so its fee would never
  be counted. It is recorded from what the session carries, once; the
  backfill is now per order and safe to run again, because nothing writes
  `orders.platform_fee` any more.
- A share abandoned and reopened after another paid left the whole bill
  fee-free: the fee rode on one session. Each share now carries its slice.

Probed on dev through the real `takeFee`: a pre-ledger table bill delivered
twice is counted once; a session whose row is gone is counted from what it
carries; an order the backfill counted is not counted again.

A third review (Codex) closed the tenancy finding and found five more, fixed:
a 409 (an idempotency key still being worked on) was read as "no session"
and released its fee; the fallback swallowed a failed read and dropped the
fee — it throws now, and a session we wrote needs no read at all; a legacy
table bill or share replayed after its fee was backfilled was counted twice —
it is keyed now by the order the old code wrote the fee on, the backfill's
key; and a share reopened by the same diner opened a fee-free second session
— the earlier one is expired at Stripe first. The cutover is closed by fact,
not code: no production restaurant has a Stripe account, so no session from
before the ledger can be open, and the migration refuses to apply while one
does. Each fix has a test in `platform-fee.spec.ts` that fails with it undone.

A fourth review (Codex) closed the 409, failed-read and cutover findings and
found one more that was diner money, older than the ledger: two checkouts for
the same share could both be open — a second request saw no session to retire
while the first was still waiting on Stripe — and a diner who paid both paid
twice, the second charge claimed nothing and was recorded nowhere. A share
whose fee is still held is refused now (409, `sharePayingOnline`), and a
second, different charge on a paid share is written as a refund due with the
restaurant told (`record_duplicate_share`; probed on dev: one refund due of
MX$55.50, the same charge again adds nothing, a charge already in the ledger
is a repeat). It also flagged that rebuilding a pre-ledger session's fee from
order history mis-keys some charges; that rebuilding is gone — no pre-ledger
session can exist, which the migration enforces.

A fifth review (Codex) found no must-fix left: no path that counts the fees
we kept short, and none that leaves a share charged twice without a refund
due. Its one should-fix, a revenue race — a share's reservation released
between "nothing reserved" and "is it still held?" let the share open
fee-free — is closed by asking once more: a ceiling that is really reached
answers the same way twice.

## A voucher payment the app would never have recorded

No diner checkout named its payment methods, so Stripe offered whatever the
restaurant's account had enabled — in Mexico, OXXO among them. A voucher paid
days later completes the Checkout session UNPAID: `settleCheckout` returns on
anything not paid, and no handler listens for the later
`checkout.session.async_payment_succeeded`. The diner's money would reach the
restaurant's Stripe balance and appear nowhere in TableTap: the bill still
owed, no payment, no refund due. Found by a read-only Codex audit of customer
accounts; it applied to every diner checkout. Each now asks for cards only —
wallets are cards — and an invariant fails on any diner checkout that lets
Stripe choose (sabotaged: it named `account/pay`).


## A lost till response never deletes committed money (W1.1)

The route and ledger had to agree about cleanup. `ring_pos_sale` now inserts,
settles and takes stock in one transaction. A route error never deletes the
order: its payment may already have committed. `W1.1 keeps a committed offline
sale when its response is lost` verifies that replay returns that ticket
without another settlement call.

## A till repeat proves settlement before the device forgets it (W1.2)

The retry lookup and device queue had to agree on what success proves. Both
retry paths refuse unpaid shells; the device requires an explicit settled
acknowledgement for its own id and amount. `W1.2 refuses an unsettled repeat`
and `W1.2 keeps a repeat that has no settled acknowledgement` cover both ends.
Legacy unpaid shells stay held for manager review, never deleted to guess
whether money committed.

## A till reference belongs to its restaurant (W1.3)

The admin lookup and uniqueness constraint had to agree on the tenant. Lookups
now include the actor's restaurant; the index covers `(restaurant_id, pos_ref)`.
The transaction locks the reference and refuses foreign references or id
collisions without ticket fields. `W1.3 scopes the retry lookup to its
restaurant` and `a foreign reference conflict reveals no ticket or total`
cover those boundaries.

## Collected money is saved before the first send (W1.4)

The request and storage had to agree on when a sale begins. Cash and own-terminal
sales are now written and read back before fetch, with their original time,
amounts and reference. Failed storage prevents sending; a missing answer, a
5xx, or a refusal that says the money is already in the drawer (`held: true`:
a changed price, an unsettled ticket) keeps one held sale and clears its cart
to prevent charging it again. Any other refusal — out of stock, the menu
closed, an account at its ceiling — is the sale not happening: the held copy is
discarded and the cart stays. Kept, it would have been replayed through the
offline path, which floors stock instead of refusing, and rung the very sale
the server refused. `W1.4 holds the complete sale before the first request
starts`, `never sends collected money if device storage refuses the write`,
`a refused sale leaves nothing held and keeps the cart` and `a refusal that
says the money is in the drawer keeps the sale held` cover these cases.
Account credit still requires a connection and is never queued as cash.

## The held receipt and server ticket agree (W1.5)

Online settlement and replay had to agree on identity and collected money. Both
now use `posRef` as the order id. The first request carries the saved collected
snapshot; a changed price is refused before recording money and remains held
for offline ingestion with its drift. A contradictory acknowledgement stays on
the device with the server id and amount; the banner names both amounts for
manager reconciliation. `W1.5 uses the device reference as the online order
identity`, `W1.5 keeps a differing acknowledgement for reconciliation`, and
`refuses an online collected amount that differs before recording money`
cover that agreement.

## Offline stock and money commit together (W1.6)

Settlement and stock had to agree on one commit. The stock floor and payment
now run inside `ring_pos_sale`; either both commit or neither does. A repeat
returns before taking stock again. The original time, collected amount, drift,
completed status and cash/own-terminal restriction are preserved. `W1.6 commits
offline stock and money in the same RPC` verifies that the route no longer
sends independent writes.

## Credit approval and the kitchen ticket commit together (W1.7)

The credit ceiling and kitchen board had to agree on publication.
`ring_pos_account` locks the account, reserves stock, inserts the order and
runs the existing `account_charge` approval in one transaction. Refusal rolls
back its unpublished order and stock together. `W1.7 never publishes an account
ticket before atomic credit approval` and `an atomic account refusal never
causes a second cleanup request` cover that boundary.



## W3-2 — cancellation and collection agree on the payment state

The route planned a cancellation while the order was unpaid; `cancel_order`
checked only its kitchen status. A collection in between left cancelled food
paid, without a refund. The read now carries the account hold into SQL, which
locks the account before the order and compares both the paid state and hold.
A conflict answers 409. The board fetches a fresh plan and asks for confirmation
again. `cancel-race.spec.tsx` checks the RPC snapshot and refusal;
`cancel-dialog.spec.tsx` checks the conflict signal,
`cancel-board.spec.tsx` verifies the second offer and confirmation, and
`accounts-sql.spec.tsx` checks the database guards and keeps
the stock gate's direct calls on the new guarded signature.

## W3-4 — waived account food is no longer collectible

Table write-offs and account balances disagreed about waived food. Both the
request and approval routes now leave accounts out; the write also checks
account membership so a charge winning the race cannot be waived afterward.
The statement, staff list, Analytics balance and all account collection SQL
exclude `written_off`. That includes a checkout opened before the food was
waived: its excess still follows the existing refund-due path.
`table-adjustments.spec.tsx`, `accounts-server.spec.tsx`,
`write-off.spec.ts` and `accounts-sql.spec.tsx` guard both sides.

## W3-5 — a hold belongs to one checkout

A checkout's settlement and the account's current hold disagreed about who
could lift it. `checkout_id` now names the owner. Open sets it; settlement and
release clear it only when it matches. Existing holds are backfilled from
their open checkout. Opening, settlement and release all lock the account
first, so a late event cannot deadlock against a new checkout.
`accounts-sql.spec.tsx` guards hold ownership and lock order.

## W3-6 — settlement pays the state it locked

Settlement's sum and its paid update disagreed when another financial write
committed between them. Checkout settlement now locks collectible orders in
ID order before calculating the amount owed. Checkout opening locks its
snapshot too. Cancellation uses the account-then-order lock order, and table
adjustments exclude accounts at the write as well as the read.
`accounts-sql.spec.tsx` checks that the lock precedes the sum.
These SQL checks inspect the function definitions; Claude must still run the
concurrency cases against PostgreSQL after applying the schema.

## W3-9 — table discounts stay on the table

A transferred account order kept its table ID. The table discount reader and
the account boundary disagreed, spreading today's discount onto yesterday's
debt. Both discount routes exclude account orders, the shared selector agrees,
and the write rechecks membership. Pending requests contain only table orders;
old requests are re-read on approval. `staff-discount.spec.ts` verifies the
MX$30 discount stays on today's MX$50 bill; `table-adjustments.spec.tsx`
checks requests and approvals.

## W3-10 — account changes share the charge lock

The PATCH route's balance read and account update were separate transactions.
`account_change` now locks the restaurant's account and checks its current debt
before changing a ceiling or closing it. A charge first means a 409 if it no
longer fits; a closure first makes the later charge find a closed account.
Management still controls ceilings, and the log uses the previous ceiling
read under the lock. `accounts-route.spec.tsx` checks stale
reads, refusals and failures; `accounts-sql.spec.tsx` checks the
transaction guard and service-only grant.

## W3-12 — the statement agrees with the whole account

The SQL balance saw every charge, while the statement read stopped at the
server's row cap. `statementOf` now uses `everyRow`, ordered by the unique order
ID, and fails if any page fails. `accounts-server.spec.tsx`
checks 1001 charges of MX$100 total MX$100,100 and a failed second page never
returns a partial statement. The same statement feeds staff, customers and email.


## A split frozen at another table's amount

The join route priced the sitting sent by the phone, while the join function
locked an independently sent split. Those two places had to agree: a cheap
sitting could freeze an expensive split, and counting paid seats then erased
the larger debt. The join transaction now checks all sitting capabilities,
sums its own locked orders and writes every share before exposing the lock.
The close transaction checks the sitting's actual unspent ledger credit before
marking any order paid. `join.spec.tsx` checks the route and
SQL contract; `checkout-settle.spec.ts` refuses an underfunded close and keeps
webhook retries working. Live SQL concurrency checks remain a release gate.

## An approval for ten pesos that erased a thousand

Request rows and manager decisions had to agree, but authenticated staff could
write every request field directly and approval trusted its order ids. Both
request tables now allow scoped client reads only; their writes go through the
role-guarded APIs. The current client already used those APIs, so no client
mutation needed replacing. It now sends the amount shown to the manager.

Both approval routes compare that amount with the saved ask and re-derived
amount. Their transactions lock the request and orders and compare again before
changing any debt, coupon use or decision. Changed requests are refused and
keep their original displayed amount. `bill-approval.spec.tsx`
reproduces forged and stale amounts, transaction refusals, failed reads and
matching approvals. Claude must verify the effective grants and concurrent
SQL behavior against the applied schema.

## Cancelled food sent back to the kitchen

The board's stages and the server's accepted updates had to agree. The API
checked only whether staff could read the ticket, and an omitted `from` meant
any status could replace any other. A kitchen login could revive refunded food
after its stock had already been returned. Every update now compares the
current status, restaurant and write-off flag atomically. Only the next live
stage is accepted; kitchen staff retain the earlier-stage undo already offered
by the board, and the floor hands over ready food. Cancelled, completed,
pending-payment and written-off tickets cannot move through this route.
A database trigger also keeps cancelled and written-off status final.

`status.spec.tsx` reproduces revival and cancellation races and
checks the legitimate moves. The offline queue keeps each step and expands
older collapsed queues on read, so reconnect follows the same allowed path.
A failed step keeps that ticket's later steps waiting. `offline-queue.spec.ts`
and `useRestaurantOrders.spec.tsx` cover replay and undo.

## A till sale filed under the wrong restaurant

The till screen and the session cookie had to agree about which restaurant
the money belonged to, and nothing checked that they did. A till tab opened
for restaurant A kept running after another tab signed in to restaurant B;
its next sale, or its held offline sales on reconnect, went out under B's
cookie, and the server filed A's cash as B's takings — while A's device,
told the sale was settled, let go of its copy. Every sale now names the
restaurant its screen was opened for (`restaurantId`, online and in
`replayBody`), and the route refuses one that differs from the signed-in
restaurant, before reading anything, with `held: true`: the sale stays on the
device until A signs in again. A till that names no restaurant is one still
running the code from before this check and is let through as before, so an
open till is not left holding every sale after a deploy. `pos-atomic.spec.tsx`
covers both paths and both exceptions; `offline-sale.spec.ts` the replay body.

## A private offline page ends with its session (W2)

The server's private render and the worker's disk cache had to agree about
whose board they held. They did not: `/dashboard/orders` and `/dashboard/pos`
were stored by pathname in `tt-v2`, survived a login redirect, and were served
to whoever next lost the connection on that tablet. Sign-out and the worker
also had to agree that deletion had finished; sending `CLEAR` proved nothing.

`tt-v3` stores private pages under the server render's user, Supabase
`session_id`, restaurant and role, with the token's expiry. The auth watcher
runs on login too. An identity change, expiry, login navigation, redirect or
401 retires those pages. Static scripts remain available; `tt-offline-sales`
is never cleared. Only a fresh server render can establish a cache identity;
an old open tab cannot restore one. Writes and clears share a queue, and a
generation check refuses responses and disk reads that overlapped a clear.
A persisted retirement marker also refuses a new response from the ended
identity while Supabase is still finishing sign-out, even after a worker restart.
Sign-out waits for `CLEARED` before ending auth or redirecting, and offers a
translated retry message if deletion cannot be confirmed.

`service-worker.spec.ts` reproduces the owner's board after a login redirect;
`service-worker-races.spec.tsx` delays network responses, disk writes and reads
across invalidation. `sign-out.spec.tsx` withholds the acknowledgement and checks
that neither auth nor the redirect happens. All use memory, with no live DB.

Claude should run Vitest first. Service workers cannot register in Claude's
preview browser, so a preview is not evidence of offline safety. In a real
localhost or HTTPS browser, load both pages online, go offline and reopen the
till as the same user. Then repeat after expiry, a login redirect, sign-out,
and a different user or restaurant signing in; the old board must not appear.
Throttle a navigation while signing out and check that no private entry returns
in Cache Storage after `CLEARED`. Check the sign-out retry copy in English and
Spanish. Hold an offline sale and confirm it remains on the device and still
blocks ordinary sign-out. No schema change is needed.

The cache label uses Supabase's stable session claim rather than an access
token, which rotates on refresh ([session documentation](https://supabase.com/docs/guides/auth/sessions)).

## Two till tabs erased each other's held sales

Two writers had to agree on one shared list, and nothing made them take
turns. Every held-sale change read the whole `tt-offline-sales` list and
wrote it back. Two till tabs on one tablet saving at the same moment each
read the list, each added their own sale, each read it back as safe — and the
later write erased the earlier sale, the only record of money already in the
drawer (Codex audit A, finding 5). Each sale is now its own key,
`tt-offline-sale:<restaurant>:<reference>`, and every change — holding,
marking a refusal, keeping a contradictory receipt, letting go — writes only
that key. The old list is still read, so a sale held by a till running the
code from before is not lost, and is only ever rewritten to take out a sale
that was sent. `offline-sales-storage.spec.ts` checks that holding writes one
key, that a sale survives another tab rewriting the old list, and that old
sales are marked and dropped one at a time.

## A held sale relabelled in today's currency

The held sale and the restaurant's settings had to agree on what the money
was, and the replay never asked. A sale held offline carried only amounts;
the server recorded it in whatever currency the restaurant used when it
arrived, so MX$100 taken before a switch to USD became US$100 in the ledger
(Codex audit A, finding 10). The till now saves the currency with the sale and
sends it on replay; `ringOffline` refuses a sale whose currency is not the
restaurant's, with `held: true`, so it stays on the device rather than be
relabelled. A till from before this sends none and is recorded as before.
`pos-atomic.spec.tsx` covers the refusal and both ways through.

## A replayed sale rewritten by today's menu

What the till sold and what the order recorded had to agree, and the replay
replaced the first with the second. When a held sale's cart still matched
today's menu, its lines were swapped for today's — a MX$100 dish stored at
today's MX$120, against a total of MX$100. When it no longer matched (a
promotion had ended), the till's own lines were kept but lost a combo's parts,
so stock came off the deal's id and the burger and fries stayed at 10 (Codex
audit A, finding 14). `ringOffline` now always records the till's lines,
combos with their parts, and uses today's menu only to measure the drift.
`offline-sale.spec.ts` checks a combo keeps its parts; `pos-atomic.spec.tsx`
that a replay records the price sold and takes each part from stock.

## An offline sale's difference that never reached the review

The replay window and the review window had to agree, and they did not. A
held sale is accepted up to 30 days late, dated when it happened; Analytics'
review read only sales dated in the last 14 days, newest 200 first. A sale
sent 20 days late with a MX$50 difference was outside the window the moment
it arrived, and 200 ordinary sales could push a flagged one off the end
(Codex audit A, finding 16). The review now counts the last 44 days (30 to
arrive plus 14 to see it) and lists every sale with a difference over them,
paged rather than capped. The demo seed now has two such sales, so the layout
and dialog gates render the card at all — with none seeded, nothing ever did.

## A closed shift that went on reporting a difference that was gone

The signed-off count and the money dated inside the shift had to agree, and
a late offline sale broke them apart. A shift is counted and closed with the
expected cash it had at that moment; a sale the till held offline, dated
inside the shift, can arrive afterwards. The record kept saying "MX$100
over" for a drawer that, with that sale, was exactly right (Codex audit A,
finding 12). The record now keeps the sign-off as it was and, when the cash
dated inside the shift has changed since, shows what arrived after the count
and the verdict as it stands now — on screen and on the printed sheet. Later
refunds and withdrawals are logged at their own time, outside a closed
shift's window, so only late arrivals move it. The seed has one late offline
sale inside its closed shift, so every gate renders the lines.

The terminal deposit had the same fault: a day marked deposited keeps the
expected figure from when it was marked, so a late card sale from that day
read as "over". Telling a late arrival from a later void booked to that day
takes the time a payment was recorded, so payments now keep it
(`recorded_at`, null on older rows, which were recorded when dated). A day's
late sales are shown beside its deposit and judged with it; the reconciled
figure stays. `terminal.spec.ts` covers a late sale, the same deposit without
it, and an old row, and the seed marks one day before a late card sale.

## The money gate's false shortage for orders sent to an account

Two of `pnpm money`'s checks had to agree on whose debt an order is, and
one of them never asked. An order moved from a table onto a customer
account keeps the sitting it was ordered at; once paid through the account
it was counted towards its sitting too, so the sitting read as "marked paid
for more than was collected" by exactly that order (Codex audit B, finding
11). The check that every settled order has a payment already treated it as
the account's; the two sitting checks now skip account orders the same way,
and the account check (1d) is where they are reconciled. Reproduced on dev
with a probe that made the order, ran the gate as it was (BAD) and as it is
(ok), and deleted what it made.


## Billing regression checks

| Rule | The bug it came from |
|---|---|
| Cashier recovery access and upload authority agree (PR2 review) | Losing POS hid the only upload surface while sign-out still protected held money |
| Deposit identity and display use the same original currency (PR2 review) | A peso deposit was reconciled against a later dollar sale |
| Saved and verified carts compare line multisets (PR2 review) | Verification moved combos first and falsely flagged unchanged mixed carts |
| The manager sees the same saved and current prices approval checks (PR2 review) | Approval showed collected totals without the menu comparison or breakdown |
| One restaurant has one billing contract | Tier changes and concurrent first checkouts created duplicate subscriptions and customers |
| Expired billing claims reconcile before takeover | A crashed checkout worker permanently blocked paying and deletion |
| Deletion ends Stripe billing first | Deleted restaurants kept paying after their local billing IDs vanished |
| Subscription pesos remain pesos | A USD menu charged the MXN catalog number in dollars |
| First-payment failure keeps the previous entitlement | An incomplete first subscription unlocked a paid tier without payment |
| Billing dates and prices follow the plan revision | Portal cancellation/resume and termination left stale dates and monthly prices |

### One restaurant, one contract

The tier selector and Stripe's contracts had to agree. Checkout now claims the
restaurant before reading or writing Stripe, reuses its pending link, and
updates the existing subscription item when changing tiers. A different pending
tier's link expires first; an unsettled contract offers its invoice or portal.
`billing-checkout.spec.ts` reproduces concurrent setup, duplicate purchase,
pending checkout reuse, and refused upgrades.

### A crashed request can be recovered

The local claim and Stripe's actual records had to agree. After 15 minutes,
recovery lists customers, open subscription sessions and non-final contracts,
records all recovered IDs, then takes over the exact expired token. Every write
checks that token, so a resumed old worker cannot charge again.
`billing-recovery.spec.ts` covers empty and previously unrecorded Stripe state,
recent claims, failed reads, competing recovery and resumed workers.

### Deletion ends billing before erasing its owner

Restaurant deletion and Stripe's lifecycle had to agree. Deletion records its
intent, expires checkout links, cancels live contracts and confirms termination
before deleting staff or the restaurant. The service-only record survives
without a cascading foreign key. `billing-delete.spec.ts` checks ordering,
failed cancellation, a completing checkout, and retry after local deletion
fails. `billing-lock.spec.ts` checks SQL declarations; live gates verify them.

### Catalog pesos stay pesos

Menu currency and subscription pricing had to agree about whose numbers they
described. Subscription checkout and monthly price displays now always use MXN.
`billing-checkout.spec.ts` reproduces a USD menu buying Servicio for 69,900
centavos; `billing-price.spec.ts` checks configured monthly MXN prices.

### First payment is not renewal grace

Stripe's first invoice and our feature entitlement had to agree. An incomplete
first subscription now preserves the previous plan and trial deadline without
linking the unpaid contract or claiming a founding place. Active or trialing
subscriptions can activate their tier; previously activated contracts retain
renewal grace. `subscription-sync.spec.ts` covers these transitions and expired
first attempts.

### Dates and prices move with the plan

Stripe's current state and the plan screen had to agree. Sync writes the end
date and monthly price together with the plan under the same revision guard,
clearing obsolete values. The cancel API uses that sync. `subscription-sync.spec.ts`
checks cancellation, resume and termination; `billing-cancel.spec.ts` reproduces
a portal resume overtaking an older cancellation response.


## W6 D5 — Stripe Prices and entitlement tiers

A subscription's metadata kept its checkout tier after its Price changed.
`subscriptionPlan` now resolves the actual item Price through a server-owned
registry or the configured catalogue Price. Checkout registers generated Prices
before use, preserving founding Prices across later catalogue changes. Metadata
mismatches are reported; unknown Prices preserve the local plan and retry.
`subscription-price-sync.spec.ts` reproduced the stale tier before the fix;
`subscription-price.spec.ts` checks unknown and configured Prices too.
Before deployment, register existing inline Prices after verifying their tiers
against Stripe billing records. Never infer an unknown tier from metadata alone.

## W6 D6 — Concurrent ceiling allocation

The trigger counted without locking; staff only had a route precheck. All four
counts now run under a restaurant row lock held through insertion. A staff invite
that loses the last seat is rolled back and returns the translated limit.
`entitlement-schema.spec.ts` checks that the lock and staff trigger exist.
Claude must verify concurrent creates with PostgreSQL; unit checks do not run it.

## W6 D7 — Dish conversions and restaurant moves

The insert-only trigger missed an add-on becoming a counted dish and a dish
moving into a restaurant at its ceiling. Updates that increase membership now
check the destination, while unchanged dishes and stock writes skip allocation.
`entitlement-schema.spec.ts` checks the update trigger and membership guards.

## W6 D8 — Freeze where management data is written

Authenticated menu, dish and table writes had role checks without a freeze
check. A dedicated trigger now refuses inserts, updates and deletes for locked
restaurants without changing tenant policies. Secret-key stock changes remain
available; no settlement, refund or kitchen table has this trigger. Loyalty's
management route also checks the freeze. `entitlement-schema.spec.ts` checks
trigger coverage; `loyalty-freeze.spec.ts` reproduces the route bypass.

## W6 D9 — Expiry without an app request

Ceilings and inventory/schedule feature checks trusted the stored trial tier
until `getPlan` ran. Both now read `effective_restaurant_plan`, which resolves
an expired local trial to Carta without touching a linked Stripe subscription.
`entitlement-schema.spec.ts` checks both consumers; live direct writes across
expiry still need Claude's PostgreSQL checks.

## W6 D10 — Dine-in beyond the page

Retained table IDs still opened new diner orders and waiter requests after a
downgrade. Both routes now check dine-in before creating anything. Bill and pay
requests remain open so existing debts can be collected. Settlement and refund
routes are unchanged. `dine-in-entitlement.spec.ts` reproduced both bypasses and
checks that requests for the bill and payment still succeed.
`waiter-order-entitlement.spec.ts` covers the waiter's table-order route too.

## W6 D12 — Buying the trial's tier

The current-tier card disabled purchase even during a trial. `PlanPanel` now
passes trial status to `PlanTiers`, which leaves that tier's purchase enabled.
`trial-subscribe.spec.tsx` reproduced the disabled card and checks its markup.

## W6 D13 — The reporting promise

Neither plan cards nor their translated copy promise a reporting lookback.
History remains unrestricted, and the unused catalogue columns and TypeScript
fields are removed instead of introducing a new restriction after a downgrade.
`entitlement-schema.spec.ts` checks the removal on existing databases; analytics
and log reads retain their existing behavior and tenant scope.

| Regression | The bug it came from | Verification |
|---|---|---|
| Partial payments and cancellations | Money collected for a cancelled dish was reused as credit for another dish, and a pooled receipt did not identify which collector or charge funded a return. | Transactional allocation probes in `pnpm api`, immutable per-order coverage, durable return reservations, and the allocation section of `pnpm money`. |
| Frozen split versus later rounds | A split share must never fund or close orders placed after the split froze. | `scripts/allocations-check.mjs` pays both shares with tips, closes the frozen orders, and proves a later order remains unpaid and unallocated. |
| PR1 overlap writers | Schema-first deployment changed the RPCs still used by main and let allocation triggers reject their writes. | `allocation-review.spec.ts` pins d7a0729 writer bodies; the app calls versioned writers under the shared money lock. |
| PR1 refund before fee | A fee lookup failure hid a successful customer refund. | `operations.spec.tsx` records the provider outcome before fee work and recovers fee work without rebooking the return. |
| PR1 duplicate refund retries | A confirmed failed duplicate refund reused Stripe's cached failure forever. | `refund-due.spec.ts` checks separately keyed durable failed/canceled retries. |
| PR1 existing tips | Partial receipt metadata counted only new gratuity and omitted tips already owed. | `allocation-review.spec.ts` checks existing-tip construction in the versioned collector. |
| PR1 cancelled history | Historical attribution excluded cancelled orders and could never assign the whole original receipt. | `allocation-review.spec.ts` and `attribution.spec.tsx` cover cancelled candidates and imported old handbacks. |
| PR1 historical currency | Pooled history borrowed today's restaurant currency and could request a return in the wrong money. | `allocation-review.spec.ts` requires evidence; `attribution.spec.tsx` carries currency through manager attribution. |
| PR1 food versus tip | Gross coverage concealed food/tip swaps. | `allocation-money.spec.ts` rejects swapped components and distinguishes explicitly unknown historical breakdowns. |
| PR1 shift explanation | Completed typed returns changed drawer cash without appearing in the shift trail. | `shift-return-trail.spec.ts` verifies amount, order, payout actor and completion time, without old-log duplication. |
| PR1 names and copy | Allocation files and payment explanations did not follow the house conventions. | `allocation-review.spec.ts` checks filenames, retired-initializer explanation and plainer copy. |

## PR1 1 — Schema-first overlap

The deployed writer and its new enforcement had to agree. Legacy RPC bodies
retain d7a0729 behavior, adding only the restaurant money lock. New callers use
`_v2` writers. Old receipts keep insertion-time scope for locked reconciliation;
strict order checks run only inside versioned writers. The SQL contract tests
do not execute PostgreSQL: Claude must rerun the main-against-delta window gate.

## PR1 2 — Customer refund and our fee

Provider success and the customer's financial record must agree even if our
fee lookup fails. Record success first. `fee_reconciled_at` remains empty until
a verified cumulative fee lookup succeeds; opening the manager's Bills list
schedules that work after the response without changing the customer's completion time.

## PR1 3 — Terminal failures and uncertain attempts

A provider attempt and its Stripe key must agree across process restarts.
`refund_due_attempts` freezes the request and account before the call. Pending
or unknown outcomes reuse it; confirmed failed/canceled outcomes advance to a
new numbered attempt. Late outcomes cannot overwrite the newest attempt.

## PR1 4 — Existing and additional tips

The debt's tip and the receipt's tip must agree. The collector attributes the
existing unpaid tip proportionally to the amount paying existing debt, then
adds only the new gratuity to the order. Rounding follows remaining capacity,
so collecting MX$55 twice against MX$100 food plus MX$10 tip records MX$5 tip
on each receipt and closes the whole debt.

## PR1 5 — Cancelled historical orders

Original pooled receipts and cancelled dishes still have to agree. A manager
can attribute to historical cancelled orders. A uniquely matching old manual
handback becomes a completed typed reservation linked to its old log. Corte
and shift sums keep using that old log once; the shift trail also excludes its
typed copy. A log arriving after the first review is reconciled on a later
locked read. Unproven manual returns remain review items; confirm only money
actually given back. Unknown Stripe provenance stays in review for provider
verification, never an automatic refund using today's account.

## PR1 6 — Currency evidence

The old receipt and the return currency must agree. Pooled pre-snapshot history
keeps a null currency; it never inherits today's restaurant setting. Attribution
requires the original receipt's currency and an audit explanation, matches each
order's currency, and records the manager's evidence. Unknown amounts display
without a currency symbol until verified. Return preparation routes mismatched
or absent currency to review.

## PR1 7 — Principal and gratuity

Food and tip capacity are separate invariants. Attribution and paid-order checks
validate both, and the money probe checks both in cents. A historically missing
breakdown is an explicit, audited exception, reported as REVIEW by the money
probe rather than silently called a clean reconciliation. Gross capacity still
applies to that exception.

## PR1 8 — Drawer sum and explanation

Typed returns and the shift's trail must agree. The trail merges completed new
returns with activity logs, sorted by completion time, with the actual payout
actor and order. Imported historical returns retain their original log line.

## PR1 9 — Names and wording

The allocation components use `OrderRefunds.tsx` and `PaymentAttribution.tsx`;
specs use `.spec.ts` or `.spec.tsx`. Both languages describe matching old
payments to orders and confirming money actually returned. The retired receipt
initializer keeps its explanation about duplicate pooled/account receipts.

## PR2: offline prices need approval before entering the ledger

The held receipt and today's menu describe different facts. Compare every money
field and priced line, including extras and combo parts. Equal final totals are
insufficient. A changed or missing dish enters a private manager queue; approval
records the saved amount and original combo stock demand in the same transaction.
`offline-authority.spec.ts` covers equal-total line forgery and
`offline-exceptions.spec.ts` covers queueing a price difference.

## PR2: receiving old money does not reopen the till

Entitlements govern new sales. The money from an already collected sale must
still be received after a freeze, downgrade or 30 days. Clock errors also keep
the original receipt and need a manager to correct the time. The queue is durable
before the device removes its copy. Approval needs a reason and confirmation;
original and corrected times are audited, preserving seconds and milliseconds.
`offline-exceptions.spec.ts` exercises those exceptions and verifies new sales
remain blocked on the same frozen plan.

## PR2: original collector and approving manager are separate people

An online till receives signed restaurant, collector and currency context. A
cashier cannot submit a different collector; legacy or unverifiable receipts
require manager attestation. Recovery reads the immutable queued body rather than
accepting replacement amounts from the caller. The order, payment and audit keep
the collector separately from the approving manager. `offline-authority.spec.ts`
covers forged and cross-tenant proofs; `offline-exceptions.spec.ts` covers legacy
attestation, manager-only approval and attempted collector/currency replacement.

## PR2: releasing a local copy requires the exact queued receipt

The queue returns the saved body after its transaction commits. Compare every
field before removing the device copy; a matching amount alone says nothing about
lines or payment method. Retries compare immutable JSON and never overwrite a
previously received receipt. Settlement still requires matching reference,
amount, method and currency. `pos-device.spec.tsx` covers lost replies and altered
queue replies; the SQL shares the restaurant money lock with ordinary POS writers
so queueing and approval cannot create a second sale.

## PR2: original currencies remain original

Manager recovery permits the original MXN/USD currency even after menu settings
change. Payment provenance snapshots the order currency. Current-currency sales,
corte, shifts, terminal totals, returns and margins exclude foreign receipts;
the manager queue, activity log and order history retain their original currency. Price drift is null across different currencies, because those totals cannot
be subtracted. There is no conversion and no need to change restaurant settings. `offline-currency.spec.ts`
checks real reader results against mixed-currency mock rows.
`offline-recovery-ui.spec.tsx` checks original-currency review and log output. Phone and desktop
checks must also inspect the queue, history and printed receipt.

## PR2: translated errors do not control retries

The API's `error` is user-facing translated copy. A separate `reviewReason` code
controls the decision to queue a receipt and is translated when managers read it.
`offline-exceptions.spec.ts` deliberately returns translated errors so matching
English keys against copy cannot quietly return.


## PR2 review: a cashier can send held money after losing POS

The locked till and the sign-out guard had to agree about where held money
could go. POS now mounts upload-only recovery after a downgrade or freeze;
Held Sales remains in cashier navigation and shows only that device's receipts.
The upload API only queues money. Queue reads, comparisons and approvals stay
manager-only. Exact receipt acknowledgement releases the device copy; a lost
response keeps it. `offline-upload-page.spec.tsx`,
`offline-upload-sign-out.spec.ts` and `offline-exceptions.spec.ts` cover access,
tenant boundaries, queue-only writes and signing out after successful upload.

## PR2 review: terminal deposits carry their currency

The payment reader and the deposit identity had to agree on currency. Deposits
are unique by restaurant, day and currency; insert, delete, read and display all
carry that currency. Analytics lists currencies separately. Older records have
no trustworthy currency column, so the schema preserves them as unverified,
outside currency arithmetic, until a manager checks the bank receipt and
records its currency with a reason. Today's setting never backfills old money.
`terminal-deposit-currency.spec.ts` reproduces the MXN 1,000 deposit / USD 100
late sale, and `terminal-deposit-api.spec.ts` checks writes and verification.

## PR2 review: mixed carts compare as multisets

The cart's submission order and verification's combo-first order had to agree.
Normalized line signatures are sorted before comparison, retaining duplicates;
equal totals still cannot conceal different quantities, products or prices.
`offline-mixed-cart.spec.ts` uses the real verifier for both dish/combo orders
and rejects a duplicate substitution at equal totals.

## PR2 review: show the difference before approval

The approval calculation and the manager's screen had to agree. Review shows
saved unit prices, extras, discounts, subtotal, service, tip and total alongside
a server-calculated breakdown and collected-minus-current difference. The
comparison loads only for the selected, tenant-scoped queued receipt. Missing
items, failed reads, unknown currency and changed currencies explicitly say
that comparison is unavailable; the manager can still recover the saved money.
`offline-comparison.spec.ts` checks real server pricing; the UI assertions in
`offline-recovery-ui.spec.tsx` cover the breakdown and unavailable state.

## Security review H1: the printer's credential reached every role's browser

The row `getMembership` reads with the service key and the props a page hands a
client component had to agree on what leaves the server. The `Restaurant` type
leaves `print_token` out, but a type removes nothing at runtime: the orders page
passed the whole row to `OrdersBoard`, so the kitchen login, like every other
role, received the printer's credential in the page's payload, and it kept
working after that person was removed. `getMembership` now drops credentials
from the row before any page sees it. `membership-credentials.spec.ts` checks
both the owner and the staff path; `pnpm rls` fetches the kitchen's orders page
and fails if the seeded token is anywhere in it. **Production tokens issued
before this fix should be rotated** (Settings → printer).

## Security review H2: a member could silence another restaurant's table

The service-request policy and the duplicate lookup had to agree on which
restaurant a request belongs to. The policy checked the request's own
`restaurant_id` but left the whole row writable, so a member could point their
own open request at another restaurant's table; the diner route then matched
duplicates by table alone and answered that table's real calls for the bill
"already asked". Staff now write `status` only (open or done), and the lookup
is scoped to the restaurant. `invariants.spec.ts` holds both; `pnpm rls` tries
the rewrite as the kitchen login and judges it by effect, with "mark answered"
as the control.
## Security review E10: a database call with the old function's arguments

The split proposal and `join_bill_split_v2` had to agree on argument names.
PostgREST finds a function by them, so a call naming the old function's
arguments found nothing; the route never read that error, and the person who
proposed dividing the bill was left without a share. It shipped in #514, when
the function gained its restaurant, table and sitting. The call now passes the
full signature and reads its error, and `invariants.spec.ts` fits every
`.rpc()` call with a literal argument object to an overload in `schema.sql`.
`pnpm api` proposes a real split and checks the proposer's seat.

## Security review G3: a "pay" link built on the caller's Origin header

The address in a link the app sends and the address the app runs at had to
agree. Nine routes built links on the request's `Origin` header, which is
whatever the caller says; for the account statement that meant an email sent
from the app's own verified sender, to any address, with a "pay" link to
another site. Links are now built on the request's own URL (`siteOrigin`), the
host the deployment answered on. `invariants.spec.ts` forbids reading `Origin`.

## Security review G8 and G9: a public route a script could hammer or crash

Cancelling a split had no rate limit, unlike proposing one, and reached the
database with the secret key on every call; it is now limited per room and per
table, and bound to its restaurant. Four public routes answered 500 to valid
JSON of the wrong type (a string for a list, a `null` rating, a number for a
name, a signature of the right length in letters but not in bytes); each now
checks the type it uses. `pnpm api` sends each of those bodies, and
`loyalty-pass.spec.ts` the signature.
