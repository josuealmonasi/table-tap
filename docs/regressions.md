# Shipping a big change without breaking something

Every bug we have shipped in this codebase has been the same shape: **two
places that had to agree, and nothing checking that they did.** None of them
were type errors. The code compiled perfectly while the staff screen said a
table owed MX$105 and the diner's screen said it owed nothing.

So this is not a style guide. It is the list of things that have actually bitten
us, and what now catches each one.

## What runs on its own

The deliberately unsigned legacy terminal example uses
`mock-terminal-times.mjs` to keep its sale and deposit before `DRAWER_ERA`.
A rolling three-day sale plus a thirty-hour deposit offset crossed that fixed
cutoff as the clock advanced, causing an otherwise fresh demo to claim modern
snapshot evidence it never had. `mock-terminal-times.react-component.spec.tsx`
checks dates on both sides of the boundary and years later. Modern demo
deposits continue through `record_terminal_deposit_v1`; reconciliation still
rejects every modern deposit missing its signed manifest.

Admission consolidation is covered by `table-member-poll.react-component.spec.tsx`,
`table-membership-poll.react-component.spec.tsx` and
`table-join-notice.react-component.spec.tsx`. They verify one serialized POST
per five-second interval, approved-sitting scope, cookie preservation after a
secondary read failure, last-good list retention, changed sitting/table/restaurant
isolation, late replies, teardown and distinct English/Spanish failure copy.
The live `check-table-join.mjs` scenario verifies the returned public projection
and that a new party cannot see the previous party's waiting phones.

`src/lib/__tests__/invariants.spec.ts` enforces the rules that span files:

| Rule | The bug it came from |
| A duplicate refund tracks customer completion and fee completion separately (S11 I5) | A failed fee return disappeared behind an already-refunded customer payment |
| A duplicate refund keeps its original charge currency everywhere (S11 I9) | Changing the menu currency relabelled money owed back and the approval amount |
|---|---|
| A retried financial operation writes one activity row (Sweep 1 #8) | One saved withdrawal, shift close, waste entry or count appeared two or more times after a lost reply |
| A floor ticket without a stage button still names its actual stage (Sweep 1 #7) | A waiter saw “Listo” on new and preparing food because only the kitchen could advance it |
| A call expires for deduplication and the board together (Sweep 1 #6) | An eight-hour-old call disappeared on reload but swallowed the diner’s next tap; an open board kept it forever |
| A failed Pedidos feed says so and offers retry (Sweep 1 #5) | A refused first orders or calls read became an empty board saying nobody was waiting |
| Membership polls release their running latch after a stalled read (Sweep 1 #4) | One unanswered admission read stopped every later poll on the staff board and diner phone |
| An extra belongs to its plate and can be sold now (Sweep 2 finding 2) | A dinner cart bought a closed-lunch steak as an extra without its required choices; combo extras bypassed the same saved links |
| Each item's own menu decides availability (Sweep 2 finding 3) | An uncategorized item from a closed menu, or one shown under an open menu's section, was still sold |
| Every icon-group write shares the desk freeze (Sweep 2 finding 4) | Creating and editing stopped on a frozen subscription while deleting still worked |
| A manual-only completion needs no app attempt (Returns verification 3) | A manager finished the return between discovery and start, but the executor required app account fields and answered incomplete |
| A manual return keeps its provider date when attributed later (Returns V6) | Discovering Monday's successful manual refund on Tuesday moved its money into Tuesday's reports |
| Completed returns preserve the eaten sale and its exact component plan (Returns 7b) | Cancelling served food would release stock, while the return route had no preparation boundary |
| A return reference keeps its exact reviewed request (Returns 7b) | A lost full-return reply could not replay after the retained total reached zero |
| Card discovery precedes attempts and only outstanding money is sent (Returns 7b) | A manual 40 was ignored before asking Stripe for another 100, or accepted as the whole promise |
| An expired unknown refund key never authorizes a new POST (Returns 7b) | A provider key can expire while its successful refund remains undiscovered |
| Sales keep their day and returns use an exclusive completion window (Returns 7b) | Reducing the live total rewrote yesterday's revenue, and midnight could count twice |
| Receipts distinguish original, returned, pending and retained money (Returns 7b) | One completed card part looked like the whole mixed return, and paid slots borrowed the table's total |
| A reprint carries the financial version already issued (Returns 7b) | A later return or provider failure changed the second copy, and the staff dialog dropped its version |
| Pedidos offers completed-sale returns only to managers (Returns 7b) | Completed orders had no return action, and sharing history with the kitchen would expose money |

| This phone can continue its own held parts (split audit 2) | A lost reservation answer left every part disabled before any Stripe page existed |
| A receipt and its activity share one identity (split audit 4) | A failed balance read skipped the log and duplicate collection retries never repaired it |
| A refused or expired slot attempt retires whole (split audit 3) | Separate slot and fee releases stranded an open attempt after one cleanup failed |
| Slot activity keeps the old unpaid tip inside a part (split model 2) | Logging only the new tip understated the gratuity already collected in the frozen part |
| Slot collections and the cashier activity show the same money (split model 2) | A cash slot reached the receipt ledger without reaching the cashier drawer log |
| A slot split reads slots rather than legacy phone claims (split model 2) | One phone saw no payable part even though every slot already existed |
| A slot checkout reserves its exact parts before Stripe and keeps them after a lost reply (split model 2) | A payable page could exist without owning the parts it would settle |
| Slot webhooks use the verified attempt, including expiry and refunds owed (split model 2) | A slot charge reached the legacy claim writer or an expiry kept its parts held |
| Whole-table collectors preserve the divided-bill refusal (split model 2) | Staff were told a generic failure or another card payment instead of which parts to collect |
| Deletion preserves collected offline receipts and unfinished fee returns (Audit L3, S25b) | Deleting a restaurant erased unapproved cash and the fee still owed after a refund |
| A saved reference names the same subject and request (Audit L4, S25b) | A milk purchase reference returned another ingredient's purchase, and a replay logged paid twice |
| A retry key is cleared only on success or an explicit no-write result (Audit L5, S25b) | A frozen retry forgot the lost MX$100 purchase and added it again after unfreezing |
| A counter reference names the first requested meal (Audit L6, S25b) | A different phone could reuse the reference with another cart and receive the first order |
| Ingredient movements lock before ingredient rows and foreign keys (Audit L8, S25b) | Legacy waste could hold the ingredient FK while waiting for a purchase's movement lock |
| Tier prices stay positive in SQL as well as forms (Audit L, S25b) | Direct writes could save zero-price tiers despite the form refusing them |
| An unresolved attempt shows and locks the request it will send again (S20b) | Reopened forms showed blank values, edited carts lost food, and cash resent a hidden account sale |
| An account sale retries its frozen cart and reference (S20 K3) | A lost reply charged the same sale to an account twice |
| Pay-later and waiter retries claim one order before stock (S20 K4) | Retrying an unseen ticket took another portion and sent another ticket |
| Pay-now retries share one pending order and its open payment page (Paths #3) | A lost reply with the same reference opened two payable orders and sent two tickets | `checkout-paynow-retry.spec.ts` (route), `s20-client-retry.spec.ts` (the menu resends its reference) |
| A withdrawal retry names its original shift and movement (S20 K5) | A lost reply took the same cash out twice, sometimes from a newer shift |
| Purchase, waste and count retries keep their saved movement (S20 K6) | A retry added a delivery twice or counted over a later delivery |
| A blind close names the reviewed shift and its saved close (S20 K9) | An old count closed a newer shift after the first answer was lost |
| The offered collection and the receipt share the same tip ceiling (S21 K1) | MX$10 plus MX$50 was offered as MX$60 but recorded as MX$20 |
| A collection checks the reviewed balance under the money lock (S21 K1) | A waiter took MX$100 after a colleague left only MX$50 owed |
| Every debt display and collection keeps the saved currency (S21 K2) | US$100 appeared as MX$100 after a menu currency change |
| Corte account debt and adjustments use the report currency; unverified activity is called out (S12 I8) | MX$100 and US$10 appeared as US$110 owed |
| Cost fees use the saved charge currency, net of returned fees (S12 I10) | An old MX$10 fee created a false 10% rate on US$100 cash |
| Product revenue and contribution share final food revenue after every discount (S12 I11/J11) | MX$100 food discounted to MX$80 still showed MX$100 revenue and MX$60 contribution |
| A corte is empty only without financial activity, including returns (S12 I12) | A refund-only MX$100 cash day hid its negative drawer and print button |
| Price breaks are whole quantities, priced by division, and the database refuses others (J4) | A tier of 1e-20 units froze the server |
| A print job closes only on the printer's success code (J9) | A printer out of paper dropped tickets unprinted |
| A typed amount reads a decimal comma as a decimal, and refuses a quantity it would have to guess (K7) | "12,50" saved a MX$12.50 withdrawal as MX$1,250, and a 0,5 l pack as 5 l |
| A price break needs a real price on every row, in the form and the route (K8) | A blank price arrived as 0 and saved "2 for MX$0": the dishes went free |
| Restaurant deletion and refund obligations share the money lock (S17 J1) | Deleting a restaurant cascaded away money still owed and completed accounting records |
| Settled books survive restaurant deletion without blocking it (S17b) | Completed receipts blocked deletion forever; removing that guard alone would erase the books |
| Sensitive admin actions and platform history survive the same deletion (S17 J15) | Password resets, admin logins, deletions and plan moves left no durable platform trail |
| A promotion's terms and components commit and read together (S14 J2) | Separate writes and reads exposed a new price with old or missing dishes |
| Frozen offers only switch off, through routes and direct writes (S14 J16) | A manager could edit or resume promotions and coupons on a frozen restaurant |
| A menu copy keeps settings and publishes only after every row succeeds (S14 J14) | A partial, active copy lost discounts, schedules, dietary tags and preparation settings |
| A printer fetch and confirmation name the same delivery generation (S16 J10) | A delayed GET fetched the next ticket, and an old confirmation closed a reprint |
| A terminal deposit names its receipt cutoff (S10 I3) | MX$50 arriving between the MX$100 read and insert was missing from both expected and late money |
| A terminal return belongs to one signed manifest or the next unsigned deposit (S10 I4) | A MX$100 return after Tuesday's sign-off reduced neither Tuesday nor Wednesday |
| A terminal day is read whole, including older recovery (S10 I6) | A 15:00 cutoff counted only MX$100 of the oldest day's MX$200 and hid a twenty-day recovery |
| A terminal return retains its original payment day (S10 I7) | A same-day MX$100 typed void left an expected −MX$3.50 at a 3.5% fee |
| Product edits and the opening stock count are separate (S13 J5) | Saving a description restored portions sold while the editor was open |
| A physical recount and older reservation releases use different generations (S13 J6) | Cancelling two held portions after a count of five raised it to seven |
| Legacy stock returns require a deduction record (S13 J7) | An old untracked sale returned portions only counted later |
| Editing and duplication wait for every menu page (S13 J17) | A thousand-row cap or read failure silently removed dishes and extras from the editor |
| A reload after a save keeps the menu on screen, and an edit made meanwhile waits for it (J17 follow-up) | Every save swapped the editor for skeletons: 289 buttons fell to 7 and the page jumped from 2,388 px to 172 px |
| Waiter orders and checkout use the same alert preference (S13 J18) | Turning off stock alerts still left waiter orders filling the bell |
| A reward handover names the displayed round, step and saved retry key (S15 J8) | Two identical requests closed one round and spent the same step in the next |
| Browser deadlines include context teardown and the whole run (S8b) | A dead worker left layout waiting on an unbounded browser call for over three hours |
| Restart retries and their evidence agree (S8b) | Concurrency three overloaded next dev; dropped visits needed bounded recovery without hiding audit failures |
| A server that hangs up or sends nothing in 60 s is retried once; a page fault never is (S8b follow-up) | On an 8 GB Mac in swap, empty responses and navigation timeouts failed whole runs with retries=0 |
| A dialog sweep comes back to its page when a click navigated away (S8 follow-up) | «Main Menu Abrir →» left /dashboard first, so the menus' rename, copy and delete dialogs were never checked |
| A page's pending requests start over when a new page commits (S8 follow-up) | Requests the departing menu editor fired as goto began were never reported, and /dashboard could never be ready again in that tab |
| A retry keeps its reference until an answer given after the lookup (K cross-review 1) | A 429 cleared a lost pay-later order's reference, and the next tap created a second MX$100 debt |
| A collection's food is sent to the cent (K cross-review 3) | 135.80 - 12.35 reached SQL as 123.45000000000002 and the MX$135.80 handed over was refused |
| Every account refusal at the till is final, the currency one included (K cross-review 4) | Answered as held, the till resent the refused account sale even after the cashier chose cash |
| A pay-later coupon's minimum is judged before the coupon, as checkout judges it (K cross-review 5) | MX$100 with a MX$10 coupon and a MX$100 minimum passed the route and was refused in SQL on MX$90 |
| A write that failed never confirms, clears or closes its form (S23 K10, K13, K20, K25) | A refused section said "added" and closed; a rejected MX$90 combo lost its fields; table 7 renamed to 8 said done and stayed 7 |
| A dish and its extras save in one transaction (S23 K11) | A failed extras insert after the delete left a MX$100 dish with none, even on a description edit |
| A failed read keeps the last good view and offers a retry (S23 K12, K16) | A failed menu refetch dropped a 200-character draft; three coupons vanished behind "no coupons" |
| An error lands in the dialog the person is looking at (S23 K17, K18, K22) | A refused write-off showed in a hidden dialog; split and approval errors and a rate-limited reset said nothing, or said sent |
| A field takes no more than is kept (S23 K14, K21, K24) | An edited coupon code said updated and kept the old one; a 200-character kitchen note lost its last 50; a MX$12.34 tip was refused |
| A coupon's hours are the restaurant's, with their offset (S23 K15) | 18:00Z showed to a Mexico City manager as 18:00, meaning 12:00 |
| Unsaved price, recipe and deal edits ask before closing (S23 K19) | Escape or the backdrop dropped a MX$80 to MX$100 price change without a word |
| A replacement confirmation settles the old ask and keeps focus (S23b 3 / Q3) | A second question stranded the MX$80 to MX$100 discard guard; saving during the question could still discard |
| Retry is inside the retained menu draft's dialog (S23b 4 / Q4) | A failed reload after a 10 to 9 stock conflict covered Retry with the modal holding a recount of 5 and a 200-character description |
| A confirmed write has affected rows behind it (S23b 5 / Q8) | An RLS-filtered MX$5 to MX$10 extra edit and table 7 to 8 rename said done after changing zero rows |
| The Spanish screen speaks Spanish, refusals and Stripe lines included (S23 K23) | Pricing refusals, sign-in errors and the service and tip lines on the payment page were English |
| A password reset answers the same whatever the provider says (S23 cross-review 2) | Supabase rate-limits only existing addresses, so showing its 429 told anyone which emails had accounts |
| A coupon edit is refused when it changes the code, and a missing coupon is not found (S23 cross-review 6) | A new code answered 200 while the old one stayed; an id from elsewhere answered ok for an update that touched nothing |
| The dialogs sweep answers a dirty form's discard question, and promises waits 30 s for a control (S23 cross-review 1, 7) | Typed-into forms now ask before closing and the sweep never answered; a bill read slower than 8 s read as a missing button |
| Browser admission and measured server memory agree (S8b) | Three workers repeatedly crossed the development server's memory threshold with no peak RSS in the summary |
| Browser navigation and the visit verdict agree (S8) | Dialog visits whose navigation failed silently vanished from coverage |
| Typing errors and failed checks agree (S8) | A failed page-field check became an empty fault list and printed ok |
| Probe deadlines and context lifetimes agree (S8) | A timeout printed a skip while its old probe kept clicking into the next one |
| Planned browser visits and reported verdicts agree (S8) | A partial sweep could finish green without accounting for every visit |
| Restart reports and the target port agree (S8) | Another checkout's Next worker restart was attributed to the server being checked |
| A statement email is capped per account and per restaurant, never on the recipient (G5) | One account code could mail the same stranger ~400 times a day |
| Coupon entitlements and card receipts agree before money moves (S5 E4) | A MX$90 discounted charge recorded MX$100 and could later reserve a MX$100 return |
| A coupon use belongs to one checkout attempt (S5 E7) | An old expiry released the newer payment page's reservation on the same order |
| Financial scope and Stripe retries agree independently of fees (S5 E8) | Bills and fee-free split shares could open two payable pages |
| Closing and changing a withdrawal share the money lock (S9 I1) | A withdrawal inserted or deleted after its shift closed rewrote the reviewed drawer |
| The money gate independently reconciles signed shifts and terminal deposits (S19) | A correct receipt ledger hid a wrong drawer sign-off or deposit snapshot |
| A drawer's amounts and labels keep its opening currency (S9 I2) | Changing the menu currency recalculated and relabelled an earlier shift |
| Shift review follows closes and late receipts, as well as openings (S9 I13) | Overnight closes and next-day corrections disappeared from the handover |
| Fee caps and remaining food principal agree (S5 E9) | Existing gratuities raised the ten-percent cap on bill and split fees |
| Displayed and payable sitting scopes agree (S5 E11) | A valid sitting older than eight hours showed debt that payment called paid |


| A table QR and membership of its current sitting are separate (S7 G2/G7) | A saved QR could read the next party’s bill, add unpaid food and claim its table pass |
| A signed card event matches our own frozen checkout before any money or expiry write (S4 E1) | A connected owner could stamp another restaurant's orders onto a cheap test session |
| Settings and the database accept the same cent-based currencies (S4 E2) | JPY entered arithmetic that multiplied every charge by 100 |
| Bill, split and account charges and receipts keep the orders' original currency (S4 E3) | Changing the menu from MXN to USD relabelled an unpaid peso bill as dollars |
| Kitchen tickets, live calls and receipt permissions agree (S6, H3) | The kitchen could query sales and print receipts; order, sitting and call-table IDs also opened public bill readers |
| Pages never receive the restaurant's credentials (security review H1) | The printer token reached every role's browser and survived their removal |
| Staff write only a service request's status; duplicates match within the restaurant (H2) | A member pointed a request at another restaurant's table and silenced its calls |
| Every `.rpc()` call names the arguments of a function in schema.sql (E10) | Proposing a split called the old signature and left the proposer without a seat |
| Links the app sends are built on its own address, never on `Origin` (G3) | A statement email carried a pay link to the caller's site |
| Menu modifier verification and defensive rendering agree (S1 G1) | Arbitrary modifier JSON crashed the kitchen board and blocked the printer queue |
| Combo extras on paper, in prices and in stock agree (S1 E5) | Component extras reached the kitchen without being charged or reserved |
| Stored destinations and validated tables agree (S1 G4) | A diner could attach table 8's label to table 7's debt, or label a counter order |
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
| Ingredient consumption belongs to its sale or waste entry | Editing a recipe from 20 g to 30 g changed ten old dishes from 200 g used to 300 g (J12) |
| A count and its movement cutoff are one database operation | A 1,000 ml delivery between reading stock and inserting a count disappeared, or left the saved expected figure stale (J13) |
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
| A handful collected across sittings commits whole (S3) | The second sitting failed after the first receipt committed, but the waiter was told it all landed. Positional references then collided on retry. `part-payment.spec.ts` injects the failure and checks stable retries, the original amount and tip; `part-payment-route.spec.ts` checks the retry error; the two-sitting API case checks receipts and coverage by effect |
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

Loyalty and terminal receipt dates now delegate to the same `localDayKey`
formatter used by reports. Their existing default-zone, clock and Date/string
input behavior stays at the callers. `day-window.spec.ts` checks all three
paths at local midnight, leap/month/year boundaries and the actual Tijuana
clock changes, including its 23-hour and 25-hour days. Invalid dates and zones
still fail instead of being assigned to another day.

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

The badge/bell SWR pilot keeps that rule: an error retains the last successful
answer, with automatic recovery. Its cache lives only in memory and belongs
to a verified user, auth session, restaurant and role. Actual React/SWR tests
in `dashboard-reads.react-component.spec.tsx` and
`dashboard-session.react-component.spec.tsx` cover shared request counts,
hidden/offline polling, action invalidation, transient failures, forbidden
badges, optimistic markers, an older poll arriving after a marker, token
refresh, sign-out, identity changes and late responses from a retired cache.
The APIs must tell it when a read failed: `navigation-reads.react-component.spec.tsx`
injects failures into every badge metadata/count query and both bell queries.
They return 503, never successful empty or partial answers.
Marker requests also carry the restaurant the bell showed; a changed active
restaurant is refused before any update. Retired callbacks do nothing, so they
cannot mutate a disposed SWR provider or send a stale write. Tests cover those
callbacks and both new and legacy authorized requests.

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
does. Current fee recording and refusal checks are in `platform-fee.spec.ts`.
The earlier share-session retirement helper was superseded by the durable
attempt flow in `diner-attempt.ts`; its unused definition and four direct
tests were removed. `diner-attempt.spec.ts` checks persisted idempotency,
lost replies, reuse of the open session and verified expiry. Split joining
freezes shares inside `join_bill_split_v2`, not the removed `writeShares`
helper; `join.spec.tsx` checks that route's transaction boundary.

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
| A reward handover names the displayed round, step and saved retry key (S15 J8) | Two identical requests closed one round and spent the same step in the next |
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
## S1 G1: the menu and the kitchen agree on modifiers

The menu's allowed choices and the stored instructions had to agree. Plain
lines and every DB-defined combo plate now rebuild modifiers from its own
groups and options. Unknown groups, removed options, wrong single/multi shapes
and nested values use the existing `missingModifiers` refusal, including for
optional groups; nothing silently changes the diner's choice. Multi choices
are deduplicated. Omitted combo plates still answer their required groups.
Like vanished extras, an invalid choice must be corrected before ordering.

Old snapshots need a second defense: the card, detail dialog and kitchen
ticket share string-only modifier formatting, ignoring non-string values even
inside arrays. `cart-integrity.spec.ts` and `order-modifiers.spec.tsx` reproduce
the forged JSON and render the actual board components and printer text.
`invariants.spec.ts` discovers order writers and guards verified inputs.

## S1 E5: a combo upgrade is the same on paper and on the bill

The component instructions, charged extras and stock demand had to agree.
The current UI sends each upgrade twice: on its plate and flattened on the
combo line. Both inputs are verified against restaurant-scoped rows, matching
copies one at a time; two plates taking cheese still mean two upgrades.
Component-only upgrades are fetched, priced and reserved too. Unmatched
parent-only upgrades remain supported and attach to the first plate so the
ticket prints them. The line's priced extras are rebuilt from those verified
plates, which also supply the ticket; stock reads that same flattened list.

Gone extras retain the existing refusal. Removing one from the cart clears
both copies, so retrying cannot restore it from a component. The E5 cases in
`cart-integrity.spec.ts` exercise the real UI builder, verification, pricing,
stock and ticket, plus the vanished-extra retry and legacy parent-only carts.

## S1 G4: where the debt belongs is where the plate goes

The validated table and the order's printed destination had to agree.
Checkout now passes the restaurant-scoped table row into `checkoutOrderRow`;
both `table_id` and `table_label` come from that row. Counter orders store
neither. The request's label is ignored. The waiter route and service requests
already take their labels from the table row, and POS accepts no table label.
`checkout-table-label.spec.ts` calls the actual route with mocked database
answers for a forged destination, a counter label and a foreign/missing table.
`invariants.spec.ts` guards those writers and the shared checkout row builder.
## A handful collected across sittings commits whole (S3)

A waiter holding MX$200 for two MX$100 sittings was told the collection worked
when the second RPC failed: the first receipt was committed and its success hid
the second error. On retry, the remaining sitting moved to position zero and
reused the first sitting's reference, so its money could never be recorded.

`record` now sends every share to `collect_on_sittings_v1`. The function takes
the restaurant money lock, backfills allocations, then locks sittings in id
order before calling the existing `collect_on_sitting_v2` inside the same
transaction. Receipts, the first sitting's gratuity, allocations and ending
splits commit together; any database error answers the waiter with a retry.
The deployed single-sitting writer stays available during the release.

Multi-sitting references include the sitting id. A single sitting keeps the
bare reference, and receipts from an old partial attempt are recognized by
both that reference and its old suffixes. The original handful is passed
separately from today's capped debt: already recorded money is subtracted from
that amount and an already recorded gratuity is never added again. Retrying a
MX$150 collection after MX$100 landed must take only MX$50, even if the table
still owes MX$100.

Both directions share the existing allocation writer and live coverage cap.
Whole-bill and own card settlement still use retained order coverage, a split
cannot collect its frozen share after the cash ends it, and account charging
still refuses sittings with pooled collections. `part-collection-schema.spec.ts`
checks the lock order, service-only grants and these shared guards. The mocked
second-sitting failure, retry and tip cases are in `part-payment.spec.ts`; the
route test requires a retry sentence before any success log or bill close.
The API case in `scripts/api-cases.mjs` creates an expired and an open sitting,
collects MX$200 plus MX$10 tip, and checks both receipts, allocations and paid
orders by effect, then removes its receipts, orders, sessions, table, print
jobs and log. Run that case only after applying the new function.

## A Stripe signature alone did not prove whose food was paid for (S4 E1)

The Connect event and the checkout we created had to agree. A Standard Connect
owner can create their own signed events with arbitrary session metadata.
`diner_checkouts` now stores the exact Stripe session ID, connected account,
key mode, restaurant, cents, currency, complete metadata and order scope before
any payment URL leaves the server. All four diner checkout producers save it,
including fee-free checkouts. A failed save attempts to expire the new session
and returns an error instead of exposing its page.

Settlement and expiry verify that record and the restaurant's connected account
before fees, coupon uses, stock or payments change. Split scope includes the
frozen food plus the diner's later orders; account scope comes from the existing
`account_checkouts` snapshot. Order scope reads are paged and chunked. Exported
card/account settlement helpers require a verified session; card helpers also
refuse IDs outside its frozen metadata. Deleted pending orders do not prevent
an authenticated expiry retry from finishing its remaining cleanup.

`stripe-provenance.spec.ts` delivers genuinely signed test payloads through the
Connect route. Wrong account, event/session mode, amount, currency, foreign
order, altered scope and an owner-created session ID leave every settlement
write untouched. It also covers failed reads, live/test key matching and direct
helper bypasses. `diner-checkout.spec.ts` checks persistence and expiry on a
failed save. `stripe-provenance-invariants.spec.ts` ties every producer and
settlement entry point to the boundary and compares the receipt SQL delta with
the canonical schema.

Pre-deploy sessions with no record are refused for both settlement and expiry;
there is no metadata fallback or automatic backfill. The release brief reports
zero connected production accounts, so this is the chosen cutover. A webhook
that races the record insert fails and can retry after persistence. If Stripe
creation has an unknown outcome or the record cannot be saved, no payment URL
is returned; unrecorded events remain refused and need investigation rather
than guessed settlement. Existing fee/stock holds remain conservatively handled
by their current failure paths. No idempotency or coupon redesign is included.

## Currency accepted by settings disagreed with cent arithmetic (S4 E2)

Settings and PostgreSQL now both allow exactly uppercase MXN and USD. The seed
uses MXN, while `plan_limits` subscription prices are independently denominated
in MXN; neither needs changing. `stripe-currency.spec.ts` first reproduced JPY,
BHD, EUR and malformed settings being accepted, then verifies refusal before a
write and continued MXN/USD support. The production constraint rejects any
unsupported existing row rather than relabelling it. Its SQL contract is in
`stripe-provenance-invariants.spec.ts`.

## A bill changed money when the menu changed currency (S4 E3)

The stored orders and the provider charge had to agree. Bill and split checkout
now use the original order currency; a split reads its frozen `order_ids`, not
only later orders on the phone. Account checkout follows its frozen order set
as well. Mixed currencies are refused before charging, with a message in both
languages asking the diner to get help paying each currency separately.

Pooled split/account receipts also used today's restaurant currency. After
provenance succeeds, the intent is bound to the durable checkout; the receipt
trigger reads its original currency/account and requires its allocation scope
to stay inside the checkout. Legacy callers with no record retain their old
behavior during deployment overlap; no existing financial signature is removed.
`diner-currency.spec.ts` first reproduced MXN food being charged as USD on both
bill and split routes, then checks original-currency charging and refusal of
mixed frozen/later orders. SQL source contracts do not execute PostgreSQL.

Still needs a person once a restaurant connects Stripe: a real Connect
completion and expiry, a repeated delivery, a wrong-account and a test-mode
event, and an old MXN bill, split and account paid after a switch to USD.
Nothing on production could exercise them when this shipped.

## Security review G5: one account code could mail a stranger hundreds of times

The statement email and the receipt had to agree on what limits a send. The
receipt is capped per order per day; the statement was capped only per caller
address, three every ten minutes, so one person holding one account code could
send about 400 statements a day to the same inbox from the app's own sender,
and more addresses meant more allowances. It is now capped per account (four a
day, the receipt's allowance) and per restaurant (100 a day), and on nothing
about the recipient, so no limit stores anything about a stranger's inbox.
`account-mail-limits.spec.ts` sends six from six addresses and expects four.

## Security review G7: a refusal that sent diners to staff who cannot help

When a table's visit cards run out, the refusal told the diner to ask the
staff, and staff have no way to make a card. It now says to try on the next
visit. The ceiling itself stays: it keeps cards nobody carries out of the
owner's numbers. Who may be handed a table's pass is decided with the table's
sitting (staff confirm new phones), which is where a stranger holding an old
QR is stopped.

## S6 / H3 — the kitchen sees tickets, not money

The board hid the daily takings, but its initial read and realtime feed still
sent whole `orders` rows. A kitchen session could select the entire sales
history with the publishable key, and the shared print route returned receipt
HTML. Hiding a total in React did not protect what crossed the network.

The kitchen now reads `kitchen_tickets`, maintained atomically by the order
trigger and published for realtime. Lines allowlist preparation fields at every
depth, including extras and combo components. A separate ticket UUID prevents a
cook from using the public order tracker to recover the bill. Sitting and split
rows are floor-only too. Calls have their own `kitchen_requests` projection:
`service_requests.table_id` also opens the public diner bill, so sending that
credential through a call chip would undo the order fix. Answering a call uses a
scoped route that returns only success. The floor keeps its existing feeds.

`actingFrontOfHouse` guards receipt reprints before reading order money. The
kitchen can still move tickets, finish each station, reprint preparation paper,
read live calls and mark them done. Completed and cancelled tickets stay readable
under RLS so their final update clears the live board. Badges remain server-side
role-scoped counts; notifications remain manager-only in both API and RLS.

Policy audit: `payments` already requires the floor; `coupons`,
`coupon_redemptions`, `refunds_due` and `notifications` already require management;
`discount_requests` and `write_off_requests` already exclude the kitchen.
`payment_allocations`, `order_adjustments`, `refund_operations`,
`refund_allocations`, `refund_attempts`, `refund_due_attempts`, `cash_shifts`,
`cash_movements`, `terminal_deposits`, `platform_fees`, `offline_sale_queue`,
`customer_accounts`, `account_checkouts`, the six ingredient/cost tables,
`restaurant_billing_operations`, `restaurant_subscription_prices`, `print_jobs`
and all four loyalty tables already revoke authenticated reads. Those guards
stay as they were. Menu prices, public offers and the platform's plan catalogue
remain readable as before; they are not restaurant sales or takings.

Checks: `kitchen-access-invariants.spec.ts`, `kitchen-orders-page.spec.tsx`,
`kitchen-print.spec.ts`, `kitchen-requests.spec.ts`, `kitchen-station.spec.ts`,
`kitchen-live.spec.ts` and the order status tests cover policy/source agreement, server props, receipt refusal,
scoped actions and live updates. `pnpm rls` now calls `scripts/rls-kitchen.mjs`,
which plants actual home rows, requires a readable ticket and call as positive
controls, checks all money tables by effect, rejects unrelated query errors,
checks that a ticket cannot open the public tracker, and removes its fixtures.
The API cases check the 403 receipt refusal, a working kitchen reprint, and an
answered call reaching the safe feed. Run those live gates only after applying
the schema. On screen, verify kitchen cards and detail show no money, calls still
arrive, both stations update live, and another device's completion/cancellation
clears the board; repeat as the floor to check totals, unpaid badges and receipts.

## A bill coupon and its receipts disagreed (S5 E4)

The quoted discount and the orders' entitlements had to agree before Stripe
charged. `diner_checkout_open` now freezes every net entitlement and discount,
checks their sum against the charge, and reserves the coupon in that same
transaction. Settlement applies those discounts once before inserting receipts.
A concurrent collection leaves its receipts intact; only the remaining food can
be discounted, and unused card money is an explicit `refunds_due` liability.
The redemption records the discount actually applied. An over-record rolls back
and retries rather than silently accepting a receipt larger than the charge.

`bill-principal.spec.ts` checks cent allocation, existing tips, full discounts
and coupon-free entitlements. `checkout-settle.spec.ts` checks bill, split,
account and pay-now dispatch, including the charge left for a split's later
orders. `bill-checkout-invariants.spec.ts` joins the quote, receipt, attribution
and refund rules. Claude must verify the SQL against the shared development
database with money, allocation and attack checks; these unit tests do not run SQL.

## An old expiry released a newer coupon use (S5 E7)

A reservation and the payment page that owns it had to agree. Redemptions now
carry `checkout_attempt_id`; confirmation and expiry target that attempt only,
once. Legacy order cleanup excludes attempt-owned reservations. Pay-now coupon
logging happens before creating the session, and triggers bind the reservation
to its durable checkout, including the former logging order during deployment.

`diner-attempt.spec.ts` checks verified attempt identity for both outcomes and
rejects unverified release. `bill-abandon.spec.ts` replays expiry and proves that
served orders never reach order-wide coupon cleanup. The invariant links the expiry,
cart producer and SQL ownership rules. The live check must expire A, open B
using the same coupon and order, then replay A's expiry and payment events.

## A fee-free payment page had no exclusion (S5 E8)

The payable financial scope and the saved Stripe request had to agree. Bill,
split and account routes share `diner_checkouts` ownership under the restaurant
money lock, even when the fee is zero. Exact scopes resume their existing page;
overlapping bill or own-order scopes refuse another page. Different shares of
the same split may still pay concurrently. Each attempt persists its Stripe
idempotency key and complete request, including tip, fee and expiry.

`diner-attempt.spec.ts` covers simultaneous opens, lost responses, expiry and
initial refusal. A refusal while resuming an uncertain older attempt cannot
release its reservation. `diner-currency.spec.ts` checks that all three routes
return an existing URL without reserving another fee. A lost response keeps its
scope and reservations until Stripe proves its outcome; retries never extend
its quote. An unrecoverable provider outcome needs investigation, not a fresh
key that might create a second charge.

## Existing gratuities raised the fee cap (S5 E9)

The plan's food-only cap and checkout's fee base had to agree. Remaining food
principal subtracts both collected money and outstanding existing gratuities.
Bill coupons discount that principal. Splits freeze it separately from their
amount and divide the one capped bill fee across shares; new tips never raise
it. Account checkout uses the same principal helper. The attempt saves the
principal explicitly. Older splits with no principal snapshot use their current
remaining principal, which can lower the fee and lets their diners keep paying.

`bill-principal.spec.ts` reproduces MX$4 food plus MX$4 tip: the MX$0.75 fee is
capped at MX$0.40. `diner-currency.spec.ts` checks the actual bill, split and
account route arguments; `bill-checkout-invariants.spec.ts` joins split freezing
and all three payment producers.

## An older sitting could see its debt but could not pay it (S5 E11)

Bill display and payment selection had to agree on the validated sitting.
`bill/pay` now calls the same `fetchTableBill` as display, with the phone's
sitting ID. A valid older sitting remains payable; a stale or foreign selection
asks the diner to review the bill instead of saying it was paid.

`diner-currency.spec.ts` reproduces payment from a sitting older than eight
hours and rejects a selection outside the displayed scope. The invariant also
checks that the phone sends its sitting and payment has no second age cutoff.
Claude must check the older sitting, a new party scanning the same table, and
the changed-bill copy on screen.

## S7 — a saved table QR was admission to the next party

The bill reader fell back from a missing or stale sitting to the table's
current sitting, while checkout joined that sitting without proving which
phone was asking. The menu, bill, split, service, session, ratings and loyalty
paths had to agree on admission; a self-chosen `diner` was not a credential.

`table-membership-bill.spec.ts` first reproduced the leak with two failing
tests. It now forbids either fallback. `table-membership.spec.ts` checks
pending/rejected phones, a forged credential, wrong restaurant/table, and
payment access to an expired closed sitting. `table-member-decisions.spec.ts`
checks all four floor roles, kitchen refusal, same-sitting member approval,
and stale decisions. `table-member-client.spec.ts` keeps overlapping first
loads from replacing the cookie and losing access to an order. Checkout tests
check refusal before stock or orders and
the unaffected first phone. `legacy-bill-access.spec.ts` protects payment for
pre-credential orders without granting membership. Invariants keep every
public table route behind these checks and keep the new credential table
private, including the reset and RLS sweeps.

`pnpm api` and `pnpm attack` include real-cookie admission, staff approval,
member rejection, forged diner ids, old-party reads/orders, stealing a table
pass, and paying one's own old orders. Their isolated table, members, orders,
requests, stock holds, accidental cards and rate counters are cleaned up. They
are written here for the release runner; they were not run in this worktree.

Look in Spanish at 360/390px and 1280px: the pending and rejected menu and
cart, the approved phone's question and matching code, and the board's
approval/rejection chips as waiter, manager, owner and cashier. The kitchen
must have no phone decisions. Approve without reloading either device, and
confirm the new phone can then order and open the bill. Close the sitting,
seat a new party, and confirm the old phone can still see/pay its own food
without seeing the new bill. Also check a staff-opened bill and a legacy
phone's own-order payment during rollout.

## Security review J4: a price break that froze the server

The stored tier and the pricing loop had to agree on what a quantity is. The
route accepted any positive `qty`, the guard floored it, and pricing used it as
stored: a tier of `1e-20` units made `left -= qty` change nothing, the loop never
ended, and the server stopped answering every restaurant. The hint search had
the same hole with a huge `qty`. Pricing now counts whole brackets by division,
the hint looks at most 12 units ahead, the route takes whole quantities from 1
to 1,000 (20 tiers at most), and the database refuses anything else
(`promotions_tiers_sound`). `promo-math.spec.ts`; `pnpm api` sends `1e-20`.

## Security review J3: a negative price the checkout honoured

Managers write promotions and dishes directly under their policies, and the
order verifier trusts the stored price. A combo at `-90` made a MX$100 cart
cost MX$10. Prices now have floors in the database (`menu_items_price_not_negative`,
`promotions_combo_price_not_negative`), and `buildCombos` skips a negative
combo anyway. `promotions.spec.ts`.

## Security review J9: a print the printer said failed, closed as printed

The printer's confirmation and the queue had to agree on what happened. Star
reports it in `code` (OK when the ticket came out, 520 and the like when it did
not), and every confirmation closed the job, so a printer out of paper dropped
the order unprinted. Only a success closes it now, and a failed write answers
500 so the printer confirms again. `pnpm api` confirms with `code=520` and
expects the job still open.


## S17 J1 — deletion and money owed

Deleting a restaurant cascaded through its refunds and receipts. The admin
route and the money ledger had to agree, and nothing checked that they did.
`admin_delete_restaurant` takes the restaurant money lock and locks its parent
row before checking pending refunds, duplicate-payment returns, unconfirmed
provider work. A check runs before billing or login changes, and the final
deletion checks again in its own transaction. The restaurant stays usable so
its team can finish returning money. Completed refunds and receipts are retained
separately under S17b below, so those records no longer prevent deletion.

`admin-safety.spec.ts` reproduces each refusal and the intervening-refund race;
`admin-safety-schema.spec.ts` checks locks, retained record classes and grants.
`billing-delete.spec.ts` preserves Stripe cancellation/retry coverage, including
retained staff IDs for cleanup after a failed Auth deletion. The API case in
`api-admin-cases.mjs` plants a disposable restaurant with a pending cash refund,
asserts refusal, the surviving refund and the audit row in the `effect` hook
(which runs for 409 too), finishes the refund, then retries deletion and compares
every retained accounting row with its pre-deletion contents. It removes its
live, retained and billing fixtures; real audit attempts stay in platform history
by design. The case is written here for Claude to run, not run in this worktree.

The terms now explain that closing does not cancel refunds or erase books.
Version 2026-10-21 stays: this clarifies accounting retention already stated in
the privacy notice, without adding a data category, purpose or retention term.
Both legal PDFs are regenerated from their JSON sources.

## S17b — completed books and deletion must agree

S17 kept books by refusing every restaurant that had them. The owner's rule is
to block only while money is owed: the deletion and the retained accounting copy
must agree, rather than tying a closed business to a live account forever.
`restaurant_accounting_records` stores one row per source record under the
restaurant ID, without a foreign key to the deleted restaurant. The locked RPC
copies orders, payments and allocations, refunds and their attempts/allocations,
adjustments, duplicate-payment returns, fees, cash records, customer accounts,
purchases, checkout provenance, activity and visits/admission decisions before
the cascade. Existing source rows are locked while copied so an update cannot
change a receipt afterward. A copy or cascade failure rolls everything back;
the route does not remove staff logins on that failure. No menu, staff directory
or restaurant profile is copied. Customer-account email (kept only while open)
and the statement's access code are omitted. Original financial IDs, amounts,
currencies, dates and actors remain in the retained records.

The table has RLS and no client policies or grants. Service can read and delete
for the privacy notice's existing fiscal/legal retention period or disposable
fixture cleanup; only the guarded definer inserts. There is no new indefinite
retention promise or automatic expiry job. `admin-safety-schema.spec.ts` failed
before the fix and now checks the copy, locks, grants and removal of the
completed-history refusal. `admin-safety.spec.ts` checks a failed final copy
leaves logins intact and records uncertainty. The API case above verifies the
pending-to-complete transition and exact retained receipt contents; Claude must
run it. J15's append-only audit stream is unchanged.

The terms now say deletion proceeds after pending money is resolved while a
separate accounting copy remains. Version 2026-10-21 stays because the privacy
notice already retains orders and amounts after account closure; no new data
category, purpose or period is introduced. Both PDFs are regenerated.

## S17 J15 — platform history and sensitive changes

Restaurant activity logs once disappeared with their restaurant, and founding-owner
password resets and platform admin changes were not written there at all.
Every admin login create/update/delete, restaurant delete and plan move now
appends a durable start before mutation and a result afterward, sharing one
attempt ID. Facts are explicitly allowlisted: identity, role, plan, profile name
and password-set/reset flags, never passwords, request bodies or provider errors.
If the start cannot be written, no action runs. A missing result remains an
unresolved start and the caller is told to inspect before retrying.

`platform_admin_audit` has no actor/target foreign keys, RLS with no client
policies, revoked anon/authenticated grants and service-only SELECT/INSERT.
A trigger rejects UPDATE, DELETE and TRUNCATE. Only a platform admin can read
`GET /api/admin/audit`; it sends uncached pages ordered by timestamp and ID.
`admin-safety.spec.ts` covers real handlers, successful and refused plan moves,
founding-owner resets, platform admin creation/deletion and both audit failure
windows. `admin-audit-read.spec.ts` covers authorization, keyset pagination,
invalid cursors and read failures. `admin-safety-schema.spec.ts` covers the
append-only stream's lack of cascading identities and mutation privileges.

## A promotion edited and read in pieces (S14 J2)

The promotion's terms and components had to agree. PATCH saved the new price,
then separately deleted and inserted the links. Restoring links after a failure
kept the changed price. POST also exposed its parent before attaching products.
`save_promotion_v1` now locks the owned parent and commits every write together;
a failure rolls back the whole change. `fetchPromotions` uses one nested SELECT,
so a concurrent edit cannot split a read across two versions.
`offers-atomic.spec.ts` reproduces split writes and failed replacement;
`promotions-data.spec.ts` checks one request. `offers-schema.spec.ts` checks SQL
contracts; it does not execute PostgreSQL. The new SQL leaves price and tier
constraints in place, including the upcoming `promotions_tiers_sound` check.

## Frozen offers that kept changing (S14 J16)

The routes and database had to agree on a freeze. Creation checked it, but
edits, resuming and deletion did not. Both routes now refuse those writes;
only `{ id, active: false }` may bypass the freeze. A database trigger applies
the same rule to authenticated writes to promotions, their components and
coupons. Changing any other field with the off flag is refused. Server coupon
claims still work, so a billing freeze cannot interrupt payment.
`offers-atomic.spec.ts` reproduces each route bypass. `api-frozen-offers.mjs`
adds cases for both kinds, with before/after effect checks and cleanup; these
cases must be run by the release owner after applying SQL.

## A menu copy that lost settings and stopped halfway (S14 J14)

The editor's loaded rows and the saved menu had to agree. It copied rows one at
a time, published immediately, omitted schedule, discount, dietary and kitchen
settings, and left earlier writes behind on failure. Prices were already
copied; that part of the audit claim did not reproduce. `duplicate_menu_v1`
reads the complete source in one snapshot, explicitly copies settings for both
products and extras, remaps sections and links, then publishes as its last
write. A failure rolls everything back. The copy preserves the original active
switch and schedule; a newly copied schedule still requires its plan feature.
Stock is always null with a fresh tracking state: physical stock stays with
the original dish. Availability stays as saved, including unavailable dishes.
`menu-duplicate.spec.ts` checks the request and failure handling;
`offers-schema.spec.ts` checks the SQL copy contract. Run the added menu-copy
API case and inspect the confirmation text in both languages before release.

## S12 I8 — the corte's currency and account debt disagreed

The currency printed beside a corte and every amount it adds must agree.
An MX$100 account debt and a US$10 debt appeared as US$110 after a currency
change. The unpaid-account query now reads only the report currency.
Monetary activity is filtered by original order currency too: new write-off,
discount and account-charge logs stamp that currency from their scoped orders.
Mixed, missing or older unverified entries stay outside arithmetic, with a
count and a review sentence on screen and paper in both languages. Ingredient
waste is not a bill write-off; discount approvals count like direct discounts.
Duplicate-charge refunds still never leave takings they never entered.
`report-currency.spec.ts` checks the real page, original-currency logging,
tenant scope, verified/foreign/unverified activity and approved discounts.

## S12 I10 — platform fees and the takings used different currencies

The numerator and denominator of a fee rate had to agree on the money.
MX$10 of old platform fees created a false 10% rate on US$100 cash. The fee
reader now joins each taken fee to its saved checkout's original currency,
scoped to the restaurant, and subtracts its returned fee cents once. Fees
without charge evidence stay outside the rate and their count is shown for
review. No historical fee is relabelled from current restaurant settings.
`report-currency.spec.ts` checks the MXN/USD probe, numeric strings, returned
fees, missing and foreign evidence, paged/chunked reads and read failures.

## S12 I11 / J11 — the final bill and product revenue disagreed

A later table coupon reduced total but left subtotal unchanged. MX$100 food
costing MX$40 with MX$20 taken off therefore appeared as MX$100 revenue and
MX$60 contribution, although analytics' total was MX$80. Both product readers
now allocate `max(0, total - service_fee - tip)` by line value, in whole cents.
Checkout discounts are already in total and are never subtracted again.
Contribution removes inclusive IVA after that same allocation; ingredients
still cost money when the food was free. `report-revenue.spec.ts` reproduces
MX$80 revenue and MX$40 contribution, then checks service, tips, IVA, coupons,
item discounts, combos, extras, full discounts and a cent shared three ways.
`report-currency.spec.ts` also checks both readers request the final amounts.

## S12 I12 — refund activity and the empty corte disagreed

Yesterday's MX$100 sale returned today correctly produced a negative drawer,
but the screen's collection-count check hid it as empty. The screen and print
button now consider all financial activity, including waived bills, account
debt, unverified entries and negative online takings. `corte-card.spec.tsx`
renders the cash-return-only day and checks the return, cashier and print
button, plus online returns, each non-collection activity and the truly empty
day. Claude must check the screen and printed sheet in both languages at
360/390/820/1280px, including the new currency-review sentences.

## S16 / security review J10: a printer confirms only the copy it fetched

The advertised token, the paper fetched and the confirmation had to agree on
one delivery. GET ignored the token and returned the oldest pending ticket, so
a second printer asking late for A received B but still confirmed A. Reprints
also reused A's row id, so an old confirmation could close a new copy.

Each requested copy now has a fresh `delivery_token`. GET matches that exact
pending generation, and its claim checks the generation again so a concurrent
reprint cannot be claimed as the old paper. DELETE has no oldest-pending
fallback: it closes only the named, fetched generation on success. Missing,
malformed, foreign, completed and superseded tokens cannot move another job.
A jam leaves the same generation available to fetch again.

`cloudprnt-delivery.spec.ts` reproduces the two-printer and late-confirmation
races, repeated reprints, a reprint during GET, and claim/confirmation failures.
`scripts/api-print-delivery.mjs` adds a real API case that fetches both the old
and new copies, sends the old success confirmation, and checks that the new
copy stays open until its own confirmation. It uses the gate's own order, which
fixture teardown removes. Apply the schema and run `pnpm api` before shipping;
check that deployed printer firmware echoes `jobToken` on GET and DELETE.

### Ingredient history survives recipe edits (J12)

A recipe and the history of what was used were two places that had to agree.
Starting at 1,000 g, ten dishes at 20 g left 800 g. Changing the recipe to 30 g
quietly made the same shelf read 700 g; two wasted dishes also grew from 40 g
to 60 g. Removing a recipe erased its old consumption altogether.

Sales and waste now freeze their quantities in `ingredient_consumption`.
`ingredient_movements` records the signed effect, including later cancellations
and corrections. The stock and buying tabs read that history, without joining
old sales to today's recipe. Snapshots are simpler than recipe versions because
only the quantities used need to survive. Legacy rows are frozen once from the
recipe available at upgrade; already overwritten recipes cannot be recovered.
`costs-history.spec.ts` reproduces the 1,000 g / ten dishes / 20 → 30 g case
and the waste case; `costs-history-sql.spec.ts` checks the snapshot writers.

### A shelf count has one movement boundary (J13)

The expected figure and the inserted count were two places that had to agree.
A purchase between the separate read and insert left a stale expected figure,
and its timestamp could put it before the new count and lose its 1,000 ml.

`record_ingredient_counts` returns the rows the database actually recorded.
The insert trigger calculates their expected quantities and serial cutoffs
under the same transaction lock used by all movement writers. It protects the
old deployed insert caller too. Purchases take that lock before their ingredient
row lock; counts do not lock orders or menu items. Pending sales becoming food,
cancellations and waste taken back record adjustments after the cutoff.
`costs-counts.spec.ts` reproduces both sides of the 1,000 ml purchase race with
a mocked database. `costs-history.spec.ts` checks sequence order against an old
transaction timestamp. `costs-history-sql.spec.ts` checks the shared lock and
trigger coverage. Claude must verify the actual two-connection race and the
additive upgrade against PostgreSQL in the isolated release gate.

## S9 I1 — a withdrawal and its shift's count share one transaction

The route checked the open shift and then wrote separately. A close between
those requests left a new withdrawal on a closed shift, or erased one that
its signed count still included. Creation, deletion and close now take
`lock_restaurant_money` before checking that exact shift. Close computes and
stores its snapshot inside that transaction. Both the signed and reviewed
figures stay unchanged when close wins; a withdrawal that wins first is
included in the count. Existing function signatures remain intact.

`cash-shift-race.spec.ts` reproduces both losing interleavings and checks both
winning withdrawals and a repeated close. `cash-shift-schema.spec.ts` checks
lock order, scoping and server-only grants. `scripts/attack-cash-shift.mjs`,
registered in `pnpm attack`, uses two real database connections to queue each
withdrawal behind close and judges its effect on rows and both totals. That
case is written for the release runner; it was not run in this worktree.

## S9 I2 — the drawer keeps the currency it opened in

The opening float and withdrawals had no currency, while the sum and screen
used the restaurant's current setting. A peso drawer became a dollar drawer
without anybody exchanging its cash. Shifts now freeze the restaurant currency
at insert; movements inherit their shift's stored currency. Insert triggers
accept the old deployed routes before the new code ships. Neither currency nor
restaurant can be changed afterwards. Existing shifts have no proven currency
for their opening float, so their backfill uses today's setting; linked
movements use the shift, and unlinked movements use today's setting too.

The close and review share `cash_shift_totals`, including only matching cash
receipts and completed cash returns, with imported historical returns counted
once. Legacy handbacks use an explicit currency or their uniquely named order's
currency where known, otherwise the shift's historical fallback. Screens,
withdrawal and count inputs, and printed handovers use the stored currency.
After a menu currency change, the cashier is told to keep the new currency's
cash separate and count only the shift currency. Selling and closing remain
available; the next shift uses the new menu currency.

`cash-shift-review.spec.ts`, `cash-shift-schema.spec.ts` and
`cash-shift-ui.spec.tsx` cover the currency switch, calculation contract and
rendered labels in the till and manager view. Check Spanish and English on
screen at 360px, 390px, 820px and 1280px, including the close dialog and print
sheet; browser and database gates are left to the release runner.

## S9 I13 — the handover includes overnight closes and late corrections

The review selected shifts by their opening date alone. A shift opened last
night and closed this morning disappeared, and an older shift corrected by
cash received today never returned. `cash_shifts_for_day` selects shifts
opened or closed since the reporting day began, still-open shifts, and closed
shifts with matching cash dated inside them but recorded today after close.
The server pages the complete result with a unique order; an `exists` check
keeps multiple late receipts from duplicating a shift. The saved sign-off is
preserved while the review shows its updated meaning. Dates on screen and on
the handover sheet distinguish an older shift from today's shifts.

`cash-shift-review.spec.ts` reproduces the overnight close and next-day late
receipt, and excludes unrelated windows and currencies. SQL contract tests
keep both predicates scoped to the restaurant and original currency. The list
heading says closed or updated today in both languages.


## S10 I3 — the receipt and the signed cutoff had to agree

`record_terminal_deposit_v1` calculates and inserts under the settlement money
lock. The saved `payment_ids`, `return_ids`, `snapshot_at` and `fee_pct` name the
exact contents and rate. A receipt outside that list is late even when its
transaction timestamp predates the lock. `terminal-snapshot.spec.ts` first
reproduced the missing MX$50 beside a MX$100 mark, then verifies MX$150 received.
`terminal-snapshot-schema.spec.ts` guards the lock, manifest and service-only
grants. Taking back a deposit takes the same lock, since it releases returns.

`scripts/api-terminal-deposit.mjs` holds a MX$50 receipt uncommitted, sends the
HTTP mark, observes it waiting for the money lock, commits, then checks the
stored amount and both receipt IDs by effect. It removes its orders, receipts,
allocations, deposit, print jobs and activity. Written here; not run here.

## S10 I4 — the return and the deposit that used it had to agree

A return allocation (or an older void's payment ID) is saved in the manifest
that reconciled it. Later returns go to the first unsigned day with sales;
with none yet, they remain visible as coming out of the next deposit. Tuesday's
MX$300 sign-off stays MX$300; its later MX$100 return reduces Wednesday's MX$200
to MX$100, exactly once. `terminal-snapshot.spec.ts` first failed on that case
and also checks the return waiting when all sales days are signed. Existing
marks with null manifests retain their old timestamp interpretation; historical
membership is not invented or backfilled.

## S10 I6 — the day offered and the day read had to agree

The recent window starts at restaurant-local midnight fourteen calendar days
back. The paged ledger includes complete older unsigned days and signed days
with late receipts. Filtering happens after arithmetic, so a recovered sale
brings all the other receipts of its day with it. The transactional writer
reads the complete ledger independently of the displayed window.
`terminal-window.spec.ts` first reproduced MX$100 instead of MX$200 at 15:00
and a missing twenty-day recovery. It also checks an older marked day and
refusal of an incomplete later page. Reports currently page the restaurant's
terminal history; no server row cap is accepted as a complete day.

## S10 I7 — the return date and the original payment date had to agree

The ledger joins each succeeded terminal return through `refund_allocations`
and `payment_allocations` to its original receipt, preserving tenant and
currency scope. Same-day returns reduce takings and their fee; later refunds
subtract the gross return while retaining the original fee. A same-day return
after sign-off carries its net amount to the next unsigned deposit using the
signed rate. `terminal-snapshot.spec.ts` first reproduced −MX$3.50 for a fully
voided MX$100 sale and checks zero, partial returns, later gross refunds and
returns already in a manifest. English and Spanish explain returns waiting on
the next deposit. Claude must apply the additive SQL, run all live gates,
and inspect these rows at phone, tablet and desktop widths; none ran here.


## S13 J5 — a description never resets the count

The form and the product writer used to agree on a stale opening count while
checkout had already deducted portions. Unchanged stock is omitted; ordinary
`PATCH /api/products` edits strip stock even from stale callers. A deliberate
recount uses `POST /api/products`, checking the count and generation the manager
saw under the dish lock. A refusal explains in both languages to reopen and
check the count. `products.spec.ts` and the products route's `stock.spec.ts`
cover stale edits and recount refusals; the API gate has an effect-based J5 case.

## S13 J6 — a new physical count replaces earlier holds

A recount of five means five available portions. Earlier holds stay recorded
for recovery, but their dish generation is superseded, so cancellation or expiry
cannot add them to that count. Other dishes in a mixed reservation still return.
Sales, waste and returns retain their generation through function-scoped settings
that restore on exit. The SQL contracts in `stock-recount.spec.ts` guard these
rules; the route tests also reject a matching count from an older generation.
Claude must verify the recount/release race against the database before shipping.

## S13 J7 — do not put guessed portions back

An older order's lines and today's inventory plan cannot prove that stock was
taken. With no historical deduction record, cancellation and abandoned-checkout
deletion return nothing for those legacy lines. Their order trigger writes
`stock=unproven` to activity, rendered in the reader's language with a request to
check the count. It leaves money handling alone and a failed activity write
cannot block cancellation. `stock-service.spec.ts` covers the legacy guess;
`stock-recount.spec.ts` checks every legacy cancellation/expiry SQL entry point.

## S13 J17 — the full menu before edits and copies

Menus, sections and items page to an empty page, ordered by position and unique
id. All read failures throw; links still page and batch their product ids.
Reload marks the editor unready before reading, and product edits and product
or menu copies refuse incomplete state. `menu-data.spec.ts` covers more than a
thousand tied-position items and each failed table read; `products.spec.ts`
checks the write and copy guard while loading.
`menu-load.spec.ts` also keeps an older read from unlocking a failed reload,
and refuses the extras replacement after that failure.

## The menu editor blanked after every save (J17 follow-up)

J17 marked the editor unready during a reload, which was right, but it also
put the whole editor back into its loading state. Every save reloads, so after
each edit the menu was replaced by three skeleton sections until the read came
back. The page shrank under the owner and threw them back to the top: in a
browser probe the save of the lowest dish dropped the page from 289 buttons to
7 and the scroll from 2,388 px to 172 px. `pnpm dialogs` lost the same moment:
after the first dialog that saved, every later button was gone, and the menu's
55 dish dialogs went unvisited while the visit still passed.

A reload now keeps the menu on screen. Keeping it there made a second
problem visible: every writer refused with a bare `if (!ready()) return;`, so a
switch flipped during the read was dropped without a word. Every writer now
awaits `ready()`, which resolves when the newest read finishes. It is true only
when that read holds the whole menu, so the edit applies a moment later, or not
at all if the read failed. A failed reload keeps the last complete menu and
its drafts on screen but disables the editor, with a retry (S23), so a stale
menu never looks editable. `menu-load.spec.ts` holds reads open and
checks all three: the edit waits, it is never sent after a failed read, and it
waits for the newest read rather than the one it found running.

## S13 J18 — the manager decides when the bell warns

A waiter's order now reads and checks the same `low_stock_alerts_enabled`
preference as checkout and the till. Stock still gets deducted with alerts off.
`stock-alerts.spec.ts` exercises both preference values through the waiter route.

## One handover consumed two rewards (S15 J8)

The round on the staff screen and the round under the card lock had to agree.
A step alone repeated in the next round, so banked visits let two identical
requests consume two MX$50 rewards. Both staff screens now save a retry key
before sending the displayed round and step. `loyalty_redeem_once` checks that
identity under the same lock as stamping and undo, saves the answer on the
redemption, and returns it on retry even after later rounds. A fresh key from
an old round asks staff to look up the card again, in either language.

`loyalty-redeem.spec.ts` reproduced two rewards consumed before the fix and
checks concurrent retries, the saved answer, stale rounds and validation.
`loyalty-redeem-request.spec.ts` checks saved keys and failed saves.
`loyalty-redeem-invariants.spec.ts` joins both screens, the private RPC,
the saved answer and the unchanged undo lock. The attack case banks enough
visits for two rounds and checks redemption rows, visits spent and round number;
it is written for the release runner and was not run here. The old RPC stays
available while the deployed route still uses it; apply the additive SQL first.

Check both staff screens in English and Spanish: repeat a handover after a
lost response, then use an old screen after another device closed its round.
Check today's unused stamp can still be undone and a stamp used for a reward
cannot. Run the API, RLS, attack and complete release gates in isolation.


## A duplicate refund and the fee still owed (S11 I5)

`refunded_at` proves that the diner was paid back; `fee_reconciled_at` proves
that TableTap's fee was returned and verified in the fee ledger. A provider
failure between them used to hide the fee forever: Bills removed the row and
a retry answered already refunded. Bills now keeps the fee visible, offers a
fee-only retry, and schedules recovery after its response. The saved fee
request fixes its amount before Stripe is called; retries reuse that request
and check provider metadata even after an idempotency key expires. A lost
response never creates another customer refund. An unverifiable fee remains
pending and keeps consuming the month's fee ceiling.

`refund-due.spec.ts` checks the failed-lookup retry and single customer log;
`refund-due-recovery.spec.ts` checks fee failure, restart, lost response,
provider evidence and the original connected account. `refund-due-list.spec.ts`
checks recovery without blocking Bills or refunding an unapproved payment.
`refund-due-api.spec.ts` checks the pending-fee response and manager guard.
The `api` case **completed customer refund retries its outstanding fee** is
written for the release runner and was not run here.

## A duplicate refund and the currency it was charged in (S11 I9)

A menu setting and an existing charge are two different facts. An insert
trigger copies currency and account from the verified frozen checkout onto
the obligation. The additive backfill uses that same evidence; background
recovery can verify older rows directly with Stripe. Without evidence the
currency stays unknown. Bills, the confirmation, activity and the money report
show the original currency or an explicit unverified amount, never today's
menu currency. The refund log still omits `method`: this money never entered
the corte and must not be deducted from it.

`refunds-due.spec.tsx` checks original-currency display and confirmation,
unverified legacy rows and activity, and the fee retry button.
`refund-due.spec.ts` checks the logged currency; `refund-due-recovery.spec.ts`
checks verified backfill and unavailable evidence. Release checks must apply
the S11 schema block first, then run the complete gates, including `dialogs`.
Look at Bills and its confirmation in both languages at 360/390px, 820px and
1280px: a USD obligation beside an MXN menu, an unverified older amount, and
a customer-complete refund whose fee is still pending.

## S8: a failed navigation is a failed visit

The dialogs runner and its coverage count had to agree. A navigation exception
used to `continue`, so the page vanished without a red verdict. Both browser
sweeps now run explicit visits through `browser-jobs.mjs`; navigation and route
errors fail that visit. `browser-gate-regressions.spec.ts` prevents the silent
skip, and `browser-ready.spec.ts` exercises failed navigation and redirects.

## S8: typing errors never become an empty audit

The typing probe and the reported result had to agree. Page typing exceptions
used to become `[]`, which printed ok. Field failures now produce faults;
uncaught typing or evaluation errors fail the whole visit. The regression test
holds this boundary; `dialog-probe.spec.ts` exercises navigation and typing
exceptions directly, and the pool's throwing-visit test checks failure delivery
at concurrency one and three.

## S8: a timed-out probe stops its own browser

The deadline and the probe's lifetime had to agree. `Promise.race` formerly
returned a timeout marker without stopping the losing probe or counting a
failure. A probe deadline now closes the visit's context before returning a
failure. The worker never resumes that visit. `browser-jobs.spec.ts` plants a
late click and proves it cannot fire at concurrency one or three. Diner cleanup
stops pages before removing that context's own member cookie, and its failure
also fails the visit (`browser-fixtures.spec.ts`). Production never removes a
member row.

## S8: every planned browser visit reports

The role/path/viewport manifest and completed work had to agree. Both sweeps
now record passed, failed and explicitly skipped visits, reject a missing
verdict, and report planned/completed counts. The pool self-tests inject a throw,
a hang and real overlapping DOM geometry at concurrency one and three; none can
make a run green. The real planted-overlap control runs before either sweep.
Readiness waits for the expected route and content, pending data, skeletons,
fonts, images and stable geometry using Node-side polling under production CSP.
`browser-ready.spec.ts` verifies unresolved pages cannot be audited early.

## S8: a worker restart belongs to the checked port

The restart warning and `DEV_URL` had to agree. A machine-wide `pgrep` counted
all Next workers, so another worktree could explain away a real failure.
`watchDevWorker()` now compares only listener PIDs on the checked localhost
port, including a lost listener. `browser-jobs.spec.ts` checks the exact port
query and excludes remote sites.


## S8b: a timeout cannot wait forever for cleanup

The deadline and the context lifetime had to agree. A visit deadline called
`close()` with no deadline of its own; normal close, the planted-overlap control,
readiness samples and final browser shutdown could also wait forever. Each now
has a bounded wait. A 90-minute whole-script watchdog fails loudly even during
setup or final fingerprints. The pool also fails every unreported visit and
cancels active contexts when its watchdog expires. Failed context cleanup stops
admission rather than leaking an old page into later jobs.
`browser-deadlines.spec.ts` reproduces the old hanging close at concurrency one
and three, and covers never-settling context/page creation, audit, late contexts,
missing jobs and both watchdogs. `browser-ready.spec.ts` holds a page evaluation
forever and requires readiness to fail within its deadline.

## S8b: a restart is evidence for one retry, never for an audit pass

A connection failure and the target server's availability had to agree.
Development pools now check DEV_URL's port before admitting work, pause all
workers behind a shared recovery wait of at most 90 seconds, and retry a
connection-level failure once in a new context. A not-ready outcome qualifies
only when the monitor saw an outage or listener PID change during that visit.
The old unconditional navigation retry is removed so a visit cannot secretly
retry more than once. Audit faults already printed, redirects, cleanup failures
and a failed second attempt stay red. Every retry is printed immediately and
retained in the visit log. Production does not use this recovery policy.
`browser-restarts.spec.ts` checks connection retry delivery at concurrency one,
two and three, unavailable servers, readiness evidence, and preserving faults
found before a later connection failure. Claude must still run the real sweeps;
these tests use fake pages and server samples without opening a browser.

## S8b: concurrency needs a memory measurement

The worker count and the server's capacity had to agree. The default is now two,
with one through four still accepted. Both development sweeps sample only the
listener PIDs on DEV_URL's port once per second and report the peak per-process
RSS and its PID, including across worker restarts. Process lookup itself has a
deadline, so measurement cannot hang the run. Missing or remote listener data
prints unavailable. `browser-restarts.spec.ts` checks the exact port, rejects
unrelated process rows and preserves the peak after a lower later reading.
Actual time and memory at one, two and three workers remain Claude's live proof.
## S19 — the ledger, the signed drawer and the bank snapshot must agree

The historical demo shift is finalized after its receipts are seeded. A
random cash receipt could land in its ten-minute window while the fixture
still claimed only the opening 200 was expected. `mock-cash-shift.mjs` now
includes those receipts and excludes offline receipts recorded after the
count, preserving the deliberate 20 shortage. The unchanged `pnpm money`
rebuilds that expectation independently. A transactional development probe
also forced an 83.40 timely receipt and a 45 late receipt: the old expectation
failed, the finalized shift passed, and all probe changes were rolled back.

The money gate previously compared payments with orders but never checked
`cash_shifts.expected_cash` or `terminal_deposits.expected`. S9 and S10 could
regress while the ledger still passed. `money-drawer.mjs` now reads every
source through the gate's ordered pagination, independently rebuilds each
closed shift at its close, and checks its signed expected amount and counted
difference. Cash receipts recorded after the close, later refunds and later
withdrawals cannot rewrite that sign-off. Imported return logs count once.

Terminal snapshots are rebuilt from their receipt and return manifests using
the saved fee rate: a same-day void reverses its fee, a later refund does not.
Duplicate membership, omitted due returns and wrong totals name the offending
row. The terminal ledger projection is also compared with raw receipts and
allocations, so a missing late arrival fails even if the old deposit adds up.
Unnamed receipts on signed days are printed individually as late adjustments;
pending returns remain visible until a later deposit consumes them. Membership
is the cutoff: a transaction can be dated before it waited for the money lock.

The era is #527's merge time, `2026-10-22T00:44:04Z`. Every run prints how many
older shifts and deposits it skips, plus checked counts, including zero.
Modern rows without snapshot evidence fail. All reads, including the terminal
projection RPC, are paginated; any read error fails the check. No writes or
snapshot-calculation RPCs are used, including by `money:prod`.

`money-drawer.spec.ts`, `money-drawer-history.spec.ts` and
`money-terminal-returns.spec.ts` cover clean reconciliation, a MX$10 sign-off
error, duplicate receipts/returns, missing late money, partial-page failures,
legacy skips, later activity and return fees. Claude runs the live gates.
The mock seed has a closed and an open shift, but its direct deposit inserts
have no S10 manifests. Before expecting a clean modern deposit run, seed one
unsigned sales day through `record_terminal_deposit_v1` after its receipts
exist; older illustrative deposits need genuine pre-era dates. This task does
not change the seed or schema.
## S20 K3 — the account and the till agree on one sale

`usePosCharge` keeps the serialized account request, including its `posRef`,
until a definite refusal or a settled ticket returns. A network error, 5xx or
unreadable success keeps it; editing the cart cannot change the retry.
`ring_pos_account_v2` already deduplicates that reference before taking stock
or approving credit. `s20-pos-retry.spec.ts` reproduces the changed-reference
bug; `pos-atomic.spec.tsx` checks the existing server replay.

## S20 K4 — the retry and the kitchen agree on one order

The customer and waiter save a reference and the exact request on first submit.
`create_order_intent` returns a previous order before reserving stock, and
commits stock, the ticket and any coupon use together under a unique reference.
A scoped read also recovers a ticket after the menu sells out. Card checkout
keeps its separate Stripe session/attempt flow; this reference applies only to
orders sent straight to the kitchen. `s20-orders-retry.spec.ts` reproduces both
routes; `s20-client-retry.spec.ts` covers unknown answers and new intents.

## S20 K5 — the withdrawal and its shift agree on one movement

The form freezes the shift, amount, note and reference. The server returns its
original movement even if that shift has since closed, before checking whether
a new withdrawal is allowed. Its unique reference is per shift and its write
still holds S9's money lock. `s20-writes-retry.spec.ts` checks a retry after a
new shift opens; `s20-retry-schema.spec.ts` checks the lock and unique index.

## S20 K6 — the retry and the shelf agree on one movement

Purchase, waste and count forms freeze their requests. Each server transaction
checks the saved reference before writing again. Purchases cannot restore an
older price, waste cannot consume another portion, and a count returns its
original expected figure and movement cutoff after a later delivery. The
movement lock still precedes ingredient row locks; product waste keeps the
item-before-movement order used by sales. `s20-writes-retry.spec.ts` reproduces
each path and `s20-retry-schema.spec.ts` protects the boundaries.

## S20 K9 — the reviewed drawer and the close agree on one shift

The blind-close form snapshots the displayed shift id when opened and freezes
it with the count and a close reference on first submit. The server returns the
saved close on retry, including its original totals, and refuses a different
close of an already closed or missing shift. An old count cannot close the
newer drawer. The refusal is translated in both languages and asks the cashier
to refresh and count the open drawer. `s20-writes-retry.spec.ts` reproduces both
lost-response recovery and a stale close; the S9 race tests still pass.

The eight S20 API cases in `scripts/api-retry-cases.mjs` send each request twice
and count actual tickets, stock, debt, movement amounts and cutoffs. They also
check a later purchase price and a newer open drawer. Each owns and removes its
fixtures. They require Claude's live gate; Vitest mocks do not execute SQL.
## S21 K1 — the offered tip and the receipt agree

The calculator uses `applyPayment`, the same ceiling as the server. MX$10 with
MX$50 typed as a tip shows the MX$20 ceiling and refuses collection until the
tip is corrected. A frozen MX$50 share with a ten-percent tip now offers
MX$55, matching its card charge; its tip is shown on the split card too.
`collection-currency.spec.tsx` reproduced the MX$50 button before this fix,
and `diner-currency.spec.ts` verifies the MX$55 charge. The shared tip picker keeps an oversized entry open with an
English or Spanish explanation. Success shows the amount and tip returned by
the receipt, including on a retry, rather than repeating what was typed.
`collection-currency.spec.tsx` and `part-payment-route.spec.ts` reproduced the
MX$60 offer and the route's silent reduction before the fix.

## S21 K1 — the reviewed balance and the locked balance agree

The screen sends the owed amount it reviewed. `collect_table_reviewed_v1`
checks it under the restaurant money lock, before attaching legacy sittings,
adding a tip, inserting receipts or ending a split. A reviewed MX$100 now owing
MX$50 answers 409 with the new balance and a request to check the money and
return change. Nothing is collected. A lost response returns the saved receipt
before checking the debt its own collection changed. Full table collection uses
the same writer without a plan gate. Closing orders checks live coverage too,
so a new round cannot be closed with yesterday's receipt.

`part-payment-route.spec.ts` covers the refusal and saved response;
`collection-reviewed-schema.spec.ts` guards lock order, scope, rollback and
service-only grants. `scripts/api-collection-refusals.mjs` judges both stale
balance and excessive tip refusals by unchanged receipts, allocations and
orders. It is written for Claude's isolated release run, not run here.

## S21 K2 — the debt and every currency label agree

`collection-currency.spec.tsx` reproduced a USD debt on an MXN menu, and
`accounts-server.spec.tsx` reproduced the missing currency on its statement.
Bills, table collection, account lists, statements, emailed/printed statements,
tips and collection confirmations now carry saved currencies. Different
currencies have separate balances and separate payment choices; their numbers
never become one displayed total. New account writers collect only the chosen
currency, while the deployed signatures remain available. New credit charges
must match the account's unpaid currency; staff can first collect it or take
cash/card for the new order, without inventing an exchange rate or extra credit. Cash and independent
terminal receipts infer their currency from their order scope; verified Stripe
receipts continue using the frozen checkout. The existing bill, split and
account card tests continue to cover original-currency charges and mixed-scope
refusals. Legacy partial-write recovery remains on the existing batch writer.

Claude must apply the changed schema definitions and new functions, run all
release gates including dialogs, and inspect Spanish copy at 360/390, 820 and
1280 pixels. Check the diner's bill, split-share payment card and tip dialog; Bills rows, totals and
promotion/write-off confirmation and manager approvals; full and partial table collection; Tables;
Accounts list, account picker, account detail and collection; and the diner's
account statement, payment choice, history, print and email. Use a US$100 debt
beside an MXN menu, USD and MXN debt on one table/account, and an excessive tip
followed by a stale-balance refusal. No live or browser gate ran in this fix.
## A decimal comma multiplied the amount by a hundred (K7)

Cash amounts (opening, withdrawal, close, bank deposit) and ingredient
quantities (purchases, counts, waste, recipes, pack sizes) were read by two
parsers that deleted every comma. A phone set to a decimal-comma region types
"12,50" on its decimal keypad, and Mexican Excel writes "35,50", so MX$12.50
became MX$1,250 and a 0,5 l pack became 5 l, silently.

Both now call `typedDecimal` (`src/lib/typed-decimal.ts`), the rule
`menu-import.ts` already used for prices. A comma followed by one or two digits
is a decimal point, since thousands come in threes, and Mexican thousands
("1,250.50") still read as thousands. "1,500" in a three-decimal quantity field
could be 1.5 or 1500, so it is refused with its own message
(`apiErr.ambiguousQuantity`) rather than guessed. `typed-decimal.spec.ts`
covers each shape and the two callers.

## A blank deal price gave the dishes away (K8)

A new quantity deal opened with a price break of `{ qty: "2", price: "" }`, and
`Number("")` is 0. The form enabled Save, and the route and database accepted
a price of zero, so "2 for MX$0" went live. The price was also a number field,
so a price the browser could not read ("12,50" on some phones) reported "" and
did the same. `typedTiers` (`promo-math.ts`) now needs a real price on every
row and never drops one row to save the rest. The price is a decimal text
field read by `typedDecimal`, and the route refuses a price of zero. The form
says what is missing instead of only disabling Save, and says when a price is
not cheaper than buying separately. `promo-math.spec.ts` and the api case "a
tier with no price" hold both places.

## Codex's cross-review of S20 and S21 (K cross-review)

A fresh Codex session reviewed S20 and S21 as a stranger would, after Claude
had reviewed and cleared them. It found five bugs, three of them in
conclusions Claude had signed off on:

- **A retry reference was cleared on a 429.** A rate limit, a timeout or a
  lapsed sign-in is answered before the server looks the reference up, so it
  says nothing about whether the first try committed. `refusalSettles` now
  keeps the reference for 401, 403, 408, 425, 429 and any 5xx, at all seven
  call sites.
- **The food amount was a float.** `recordReviewed` sends `round2(amount - tip)`.
- **The till held a refused account sale.** The POS route now treats
  `mixed_currency` as a final account refusal.
- **The coupon minimum was judged after the coupon.** It is now judged on the
  route's `base.subtotal`, passed as `eligible_subtotal`.
- **A reopened form resubmitted a hidden pending request.** This is S20b:
  every form with an unresolved attempt shows it and locks its fields.

Each fix has a test that fails without it.


## S20b — the request sent again and the visible form agree

A saved reference and its screen had to agree. Keeping the request prevented
another withdrawal, count or sale, but reopening its form erased its visible
values. Editing an order after a lost reply changed the screen while sending
the older food, and clearing the cart then erased food never sent.

`useRetryIntent.frozen()` exposes a copy of that saved request and refreshes
its owner when it changes. Withdrawal, close, purchase and count restore their
fields on reopen; waste keeps its fields locked. Cost forms retain the original
ingredient names and units, and drawer forms retain the reviewed currency. Each uses `PendingAttempt`
and offers **Send again** until success or `refusalSettles` releases it. The
waiter's pad locks its menu with disabled buttons, table scanner, lines and note while that round is
unanswered. The diner's cart instead shows `PendingOrder`: the original food,
choices, note, name, coupon and tip. Later additions stay in the cart, including
extra portions of a dish already sent. Sending the same account sale again is the only POS
action offered while it is pending: its account, original amount and food are
shown before another cash or card choice can appear. A retry remains available
when a menu closes or ordering pauses after the first send.

`pending-forms.spec.tsx` reproduces all five forms with lost replies, remounts,
locked edits and fresh forms after success or definite refusal.
`pending-orders.spec.tsx` reproduces the waiter, diner and POS, including food
added after the first send. The existing S20 transport tests still protect
unknown replies, rate limits, settled refusals and unchanged request bodies.

New keys in **both** `en.ts` and `es.ts`: `pending.sendAgain`,
`pending.withdrawal`, `pending.close`, `pending.purchase`, `pending.count`,
`pending.waste`, `pending.order`, `pending.account`, `pending.moreFood`,
`pending.coupon`, `pending.tip`.

Claude must run the isolated release gates, including `layout` and `dialogs`,
and inspect these eight surfaces in both languages at 390 and 1280 pixels.
Use a lost reply followed by close/reopen or an attempted edit, then a repeated
send. Also check an order after ordering pauses, the diner's later additions,
and an account retry after the account picker closes. There is no schema change.

## A form says what happened (S23, audit K findings 10–25)

Codex started this and was cut off by its usage limit; Claude finished it
(typing, a missing return, docs, a field guard and the live api cases). The
findings share seven shapes, each fixed everywhere it appeared:

- **A failed write looked like success.** The menu writer's `run`,
  `insertReturningId` and `move` now return whether they wrote, and callers
  confirm, clear or close only on success. The same goes for the promotion
  forms (now awaited), the table rename and the ratings sheet.
- **Extras were replaced in two steps.** `save_product_addons_v1` saves a dish
  and its extras together. `product-save-fields.spec.ts` keeps its field list
  equal to the route's, and three api cases check a create, a replacement, and
  a refused extra that leaves the dish untouched.
- **A failed read showed "nothing".** The menu editor keeps the last complete
  view and the open drafts, disables editing, and offers a retry. J17 still
  holds: nothing saves from a partial menu. The coupon list keeps its last
  rows and says it could not load.
- **Errors landed out of sight.** The write-off refusal is shown in its own
  dialog. Split and approval errors are shown. The password reset reports a
  rate limit or an outage, and still never reveals whether an email has an
  account.
- **Fields took more than was kept.** A coupon's code is read-only once it
  exists. The till's name and kitchen note share the route's limits and count
  what is left. The custom tip takes cents.
- **Times had no zone.** Coupon hours are shown and read in the restaurant's
  zone and saved with their offset (`zoned-input.ts`). A daylight-saving
  minute that is skipped or repeated is refused rather than guessed.
- **English on the Spanish screen.** Promotion pricing refusals return keys,
  sign-in errors map the provider's codes (`auth-error.ts`), and the service
  and tip lines sent to Stripe are in the diner's language.

Unsaved dish, extra, recipe and deal forms ask before closing through
`useDirtyClose`, which a modal consults only when its form opts in.

## Codex's cross-review of S23

A fresh Codex session reviewed S23 after Claude had finished it, and found
six problems. Claude fixed three in fix-s23c; Codex fixed the other three
(S23b):

- **Recovery revealed accounts.** `authErrorKey(…, true)` now returns null
  for every provider answer. Only a request that got no answer at all says
  the service is unavailable. The tests that expected a 429 or a 503 to show
  now expect the neutral confirmation.
- **The coupon route ignored a changed code and answered ok for nothing.** It
  reads the caller's coupon first (404 if missing), refuses a code that
  normalises differently from the saved one, and confirms an update only when
  a row came back. See `coupon-edit.spec.ts`.
- **The gates did not keep up with the forms.** `answerDiscard` clicks
  «Descartar cambios» after the sweep's Escape. Both of promises' waits for a
  control are now 30 s, like every other readiness wait.


### The coupon dialog, looked at

Screenshots of the edit dialog at 390 px and 1280 px, in Spanish, after the
cross-review fixes:

- **The zone note read "America/Mexico_City".** It now names the zone as
  Settings does: «Ciudad de México (GMT-6)», through `zoneName` in
  `timezones.ts`. A zone the list does not offer keeps its IANA name.
  Tested in `timezones.spec.ts`.
- **The read-only code looked typeable.** `.tt-input[readonly]` gets the
  inset surface and a dashed border. The other read-only field, the printer
  link in Settings, gets the same look.
- **An edit opened on «50 · 100 · 200» with nothing saying which number was
  which.** The placeholders were the only names, and a filled field has
  none. Every field is now a `.tt-field` label above its input. The type
  select grew to 160 px, because «% de descuento» was clipped at 130.

### The discard question must finish (S23b finding 3, Q3)

The confirmation provider and the dirty-close guard had to agree on when an
ask finished. Replacing the single resolver left the first caller waiting
forever. A newer question now cancels the older one, and provider unmount
cancels its pending answer. The confirmation contains keyboard and programmatic
focus, restores it on close, and sits above a menu form's portal. The guard
checks saving and mounting again after the answer. `s23b-confirm.spec.tsx`
exercises the real provider, including the MX$80 to MX$100 draft, replacement,
unmount, a save overtaking discard, and Tab in both directions.

### A retained draft must be able to retry (S23b finding 4, Q4)

The reload notice and the active form had to agree on where recovery lived.
Retry was outside a disabled fieldset, but behind its modal. Menu dialogs now
keep a stable portal outside that fieldset, put the same retry notice inside
the dialog, and disable only its form after a failed read. The portal and form
wrapper stay mounted through failure and recovery, preserving the draft.
`s23b-retry.spec.tsx` checks that recovery stays outside the disabled draft.
The writer's separate J17 readiness check still refuses every mutation until
the latest read holds the complete menu; `menu-load.spec.ts` checks that rule.

### A null error does not mean a row changed (S23b finding 5, Q8)

RLS and form feedback had to agree on what success meant. An update filtered
to zero rows returned no error, so the extra form closed with MX$5 still saved
and a table rename reported success with its old label. Menu and table writers
now request affected rows, and `writeError` checks the returned rows or exact
count before confirming. Reorder checks both siblings, optimistic switches
roll back, inserts require an id, and imports and bulk deletes require the
whole expected count. `s23b-writes.spec.ts` pairs zero rows with explicit errors
and checks successful writes as well.

## S24: a full-screen sheet is a dialog, and the till's charge has a way back

Found while checking S23's POS counters in a browser, at 390 px and 1280 px.

- **The till's charge had no way back below 1025 px.** «Cobrar en efectivo»
  opens a sheet that fills a phone or an iPad. Its only exit was "click
  outside", an empty strip under the form that nobody would think to tap. A
  cashier who pressed cash for a card sale could only send the order. The
  sheet now has «Volver a la venta» beside the send button. It changes
  nothing, and the name and note stay.
- **No sheet said it was a dialog.** `DetailOverlay` (the dish, the cart, a
  combo, the order tracker, the till's charge) had no `role="dialog"`, no
  label, no Escape and no focus handling. A screen reader read the menu behind
  it, and Tab walked into that menu. The dialogs sweep looks for
  `[role=dialog]`, so it never measured these sheets, and it left each one
  open over its next click. `useOverlayDialog` now moves focus in (the first
  button, so a phone doesn't raise its keyboard, or a field that asked for
  focus), traps Tab, gives focus back on close, and answers Escape only when
  it is the topmost dialog. The coupon dialog over the cart therefore closes
  alone.
- **Two places that must agree:** the till's charge and the tracker built the
  overlay by hand. `useOverlayDialog.spec.ts` fails if any component spells
  `className="tt-detail-overlay"` outside `DetailOverlay`, and the `label`
  prop is required.

## Audit L (S25a): collections, the editor's latest read, and gates that pass unchecked

Codex audited everything shipped on 2026-10-21 and 22 (audit L). Claude
verified each finding in code and fixed these four. Codex fixed 3, 4, 5, 6
and 8 in S25b.

| Bug | The two places that had to agree | What catches it now |
|---|---|---|
| A table collected without the balance its screen showed recorded what it owed on arrival: MX$150 cleared for MX$100 seen | `SettleTableDialog`'s reviewed figure and `/api/table-payment`'s old-tab branch | `collection-full-account.spec.ts` (L1); `attack-money` checks the unreviewed shape records nothing |
| An old tab's part payment took the debt's currency: MX$100 typed cleared US$100 | The menu currency the old calculator showed and the shim's inferred currency | `part-payment-route.spec.ts` (L2) |
| A copy made during a reload copied the old price and extras; reorders and failed toggles used the menu from before the read | The arrays an action was called with and the read `ready` waited for | `s23b-writes.spec.ts` (L7) |
| A role whose password was missing was "skipped", and skipped counted as passed; a dialog that opened after a read was never measured | `crewCookies`' skip and `manifestFailures`; the 700 ms look and the read the click started | `browser-fixtures.spec.ts`, `dialog-probe.spec.ts` |

- **Finding 1.** Today's dialog always sends the reviewed figure. Its
  buttons appear only once the bill has loaded. The unreviewed branch
  served tabs opened before #531, and it collected whatever the table owed
  when the request landed. It now answers «Esta pantalla está
  desactualizada…» (409) and records nothing. The table-only code that sat in
  the counter-order path afterwards is gone. `rls-check` and `attack-money`
  send tables the reviewed shape, with the table's real balance. Without
  it, the other-restaurant check would pass on the refresh answer and never
  test the scope.
- **Finding 2.** The old calculator showed every figure in the menu's
  currency. The shim now infers a currency only when the debt is in that
  one, and refreshes otherwise.
- **Finding 7.** `ctx.latest` holds what the latest complete read returned.
  The duplicate and the import read it after waiting. `move` picks the
  siblings from it. A failed switch or schedule reloads, rather than
  restoring arrays from before that read.
- **Finding 9.** A missing password fails that role's visits (dialogs,
  layout) and is a GAP in promises, unless the run names the role in
  `GATE_SKIP_ROLES` on purpose. The dialogs sweep waits for a read the click
  started before deciding that nothing opened.


## Audit L (S25b)

### L3 — deletion and unresolved money

`admin_delete_restaurant` refuses unapproved `offline_sale_queue` receipts and
completed refunds whose cumulative rounded fee share is still owed. No fee,
a share rounding to zero, and a share already returned do not block deletion.
A provider-verified `fee_request` also protects older charges without a fee
ledger amount. Approved queue rows are archived by `pos_ref`, outside the
restaurant cascade. The new admin refusals are translated in both languages.
`audit-l-s25b-sql.spec.ts` checks the guards precede deletion and the queue copy.
Claude must execute the SQL scenarios with and without outstanding fees.

### L4 — references and the first request

Purchase retries compare the ingredient, original pack count and total before
returning their saved id. Packs are saved because today's pack size cannot
prove yesterday's request. Waste compares subject, quantity, reason and note;
counts compare the whole sorted set; withdrawals compare shift, amount and
note; closes compare shift and counted cash. Account sales compare account and
canonical request in both the early read and locked writer. Conflicts return
409 with `apiErr.retryConflict`, without the earlier result. A referenced
purchase uses the additive `record_purchase_once_v2` writer to save its one
paid log inside the same transaction, and every
service-key ingredient-name read is restaurant-scoped.
The old purchase RPC remains available for old routes that log separately;
apply this SQL before deploying the new route.
`audit-l-s25b-purchases.spec.ts`, `audit-l-s25b-account.spec.ts` and
`audit-l-s25b-sql.spec.ts` cover the routes and SQL contracts.

### L5 — a refusal is not evidence that an earlier send failed

Clients keep their frozen reference on every unmarked refusal, including 402,
paused ordering, plan changes and validation. Only a serialized SQL outcome
that committed none of the requested action carries `retryUncommitted: true`.
A success ends the attempt too. Every pending screen offers an explicit stop
retrying action with a second confirmation: check the records first; stopping
a retry neither cancels a committed action nor returns its money. Existing
retry fixtures now mark their definite no-write answers; they no longer teach
clients to trust a bare status. `audit-l-s25b-retry.spec.ts` proves that a lost
MX$100 purchase, a refusal while frozen, and an unfrozen retry record once.
`audit-l-s25b-discard.spec.tsx` exercises the deliberate discard confirmation.

### L6 — the counter request is part of its identity

Diner and waiter scopes include a SHA-256 digest of canonical items, choices,
extras, combo components, table (or none), coupon, tip, note and customer name.
Display prices and names are excluded because the server prices the meal.
A counter diner needs no new browser credential: the random reference plus the
same request recovers the saved order, even with browser storage unavailable.
A changed request returns only a conflict. Older scopes cannot prove a match
and are refused for review instead of being answered or recorded again.
`audit-l-s25b-orders.spec.ts` verifies changed requests and exact replays with
no member cookie; `audit-l-s25b-account.spec.ts` checks display-only changes.

### L8 — the legacy waste/purchase cycle is real

A legacy waste insert can acquire an ingredient FK key-share lock before its
AFTER movement trigger waits for the restaurant movement lock. A purchase can
hold that movement lock and wait for `ingredients FOR UPDATE`, which conflicts
with the waste's key-share lock. Legacy waste now explicitly locks movement
before reading an ingredient or inserting a foreign key. Product waste keeps
the shared sales order: menu item, movement, ingredient. Both old and referenced
purchase, waste and count RPCs obey that ingredient order.
`audit-l-s25b-sql.spec.ts` checks these boundaries. Claude must run a concurrent
legacy-waste/purchase exercise; no live database was used here.

### Tier prices — CHECK and form agree

`tiers_sound` now refuses prices <= 0. The existing
`promotions_tiers_sound` CHECK is recreated and validated so older rows cannot
silently keep the weaker rule. Before applying SQL, count violating rows:

```sql
select count(*) as violating_rows
from public.promotions
where jsonb_path_exists(tiers, '$[*] ? (@.price <= 0)');
```

Correct those offers before applying; do not make up replacement prices.
`audit-l-s25b-sql.spec.ts` checks the stricter rule and CHECK wiring.

### Claude's review of S25b

- **Too strict about what settles a reference.** As written, only the
  transaction's own refusals (short stock, a coupon) released a reference.
  Every other refusal after the lookup left the diner, waiter or cashier on
  «Enviar otra vez» with a cart that could never go: a dish taken off the
  menu, a closed kitchen, «not accepting orders». Before S25b all of those
  returned to the cart. Once the lookup has found nothing saved, a refusal
  settles the attempt, and so does a refusal of what was typed, wherever it
  falls, since the same request can never succeed. The frozen plan, plan
  checks, a lapsed sign-in and «no open shift» come before the lookup or
  depend on state, so they keep the reference, which was the point of
  finding 5. `audit-l-s25b-lookup.spec.ts` fails on a refusal after the
  lookup without the mark, and on a frozen-plan check moved after it.
- **Copy in the system's words.** «Esta referencia ya se usó…» and «Dejar de
  reenviar este intento» became «Esto ya se había enviado antes con otros
  datos…» and «Ya no enviar esto».

### Codex's cross-review of batch 5

A fresh Codex session reviewed S24, S25a and S25b together and found seven
problems. Codex then hit its usage limit, and Claude fixed all seven:

1. **Claude's widening of `retryUncommitted` could release a reference
   while the first request was still committing.** Request A stalls before
   writing, and retry B meets «orders paused». Marked uncommitted, the phone
   forgot the reference, A committed, and the next send made a second
   MX$100 order. Route refusals no longer carry the mark. The client decides
   instead (`refusalSettles(status, retried, uncommitted)`):
   - the first send of a fresh reference settles on any 4xx except 408 and
     425, because no other request carries that reference;
   - a retry settles only on a mark the writer set under the restaurant's lock.
2. **The old-tab currency shim could not prove what the tab showed.** A tab
   opened in pesos showed MX$100, and after a switch to dollars the same tap
   cleared US$100. Old tabs now refresh before collecting.
3. **Rows saved before the deploy conflicted on their unchanged retry.** The
   clients in production forget a reference on a 409, so that was a second
   order, purchase or account sale.
   - Orders fall back to the old scope, also after a write conflict.
   - Account sales without a scope match on their account.
   - Purchases without packs match on ingredient and money.
4. **A saved provider fee request did not block deletion beside a fee ledger
   row.** MX$3 owed, a local share that rounded to zero. It blocks now, unless
   the share was returned in full.
5. **A successful switch never read back.** A copy made next took the old
   availability. Switches now read back either way.
6. **`rls-check` could pass on a stale-balance refusal.** It now collects a
   table it controls, with a positive control on our own.
7. **The dialogs sweep never reached the till's charge**, which needs a dish
   in the sale, and nothing pressed Escape on the diner's sheets. `layout`
   now opens the charge and the till's dish sheet through `before` steps.
   After measuring, Escape must close them. Each diner flow checks how many
   dialogs Escape leaves open (`escape`).

### «Este pedido no se confirmó» while it was being placed (production, 2026-10-22)

A diner on production saw «Este pedido no se confirmó. Envíalo otra vez…»
over a «Guardando…» button, while the order was still on its way. It read as
an order that had failed.

- **Why.** Every retry banner was shown whenever a retry key existed. A key
  exists from the moment a request goes out, so the banner showed during
  every first send. That affected the diner's order, the waiter's pad, the
  POS account sale, the withdrawal, the drawer close, purchases, counts and
  waste.
- **Now.** `useRetryIntent.unconfirmed(sending)` is true only once a send has
  ended without an answer, and through the retries after it. The first send
  shows the screen's own loading state: «Enviando a la cocina…».
- **The words.** Each message now says what is known: «No recibimos la
  confirmación… Puede que ya haya llegado a la cocina: envíalo otra vez para
  saberlo, no se repetirá». The retry button says «Enviando…», not
  «Guardando…».
- **One message at a time.** A lost order no longer opens «Atención: Error de
  red» over its own retry screen. A refusal still shows, because it says
  something the screen does not.
- **The screen itself.** The banner's paragraphs had their default margins,
  and its discard answers borrowed the sticky form footer, which drew a white
  block across it at 1280 px. Both now have their own classes.
- **Tests:** `useRetryIntent.spec.ts` and `s20-client-retry.spec.ts`.

### The diner's header, spaced as one stack

The «¿Dejar entrar a otro teléfono?» card sat flush under «Sigue tu pedido».
Every other card in the header carries `margin-top: 12px`, and the request
chip, which is shared with the staff bar, had none. `.tt-menu-header
.tt-request-chip` gets it there only. Measured at 390 px: 12 px between the
banners, and 12 px to the card.

## Batch 5, second cross-review — refund fees (findings 2 and 4)

| Rule | The bug it came from | What checks it |
|---|---|---|
| Customer completion and deletion agree that an unchecked fee is unknown | A completed MX$0.10 refund let deletion erase MX$3 owed when the first provider read failed | `batch5-fee-schema.spec.ts`, `fee-recovery.spec.ts`, `fee-verification.spec.ts` |
| A cumulative fee target and an individual attempt are separate | A saved 300-cent request could never return the remaining 200 after someone separately returned 100 | `fee-recovery.spec.ts` in MXN and USD |

### Finding 2 — an unchecked fee looked like zero

Both refund books now carry `fee_verification_pending` from creation and set
it with customer completion. Deletion checks that fact under the money lock
before copying or deleting anything. Fee verification records the provider's
cumulative target separately, including an explicit zero. Order refunds only
finish fee verification for customer refund IDs seen in the provider snapshot;
a refund completed after that snapshot waits for its own check. A short fee
return stays pending, and customer completion still succeeds during an outage.

Old completed rows with an existing reconciliation stay complete. A trusted
saved checkout that requested no fee, or a local fee returned in full, also
releases them through an idempotent backfill. No fee row is not proof of zero;
unproved rows use the ordinary fee-only recovery from Bills. This deliberately
blocks deletion until the provider is verified, while selling, collecting and
customer refunds stay available. The new refusal is
`apiErr.restaurantDeleteRefundFeeVerification`, in both languages.

Claude can run this read-only production query **before applying the schema**
to count existing completed rows without a fee reconciliation:

```sql
select 'refunds_due' as source, count(*) as awaiting_verification
from refunds_due where refunded_at is not null and fee_reconciled_at is null
union all
select 'refund_operations' as source, count(*) as awaiting_verification
from refund_operations
where source = 'stripe' and status = 'succeeded' and fee_reconciled_at is null;
```

After applying it, this counts the remaining rows without proof and those
already safe to release (the same check deletion uses):

```sql
with completed as (
  select 'refunds_due' as source, restaurant_id, stripe_payment_intent,
    fee_verification_pending, fee_reconciled_at
  from refunds_due where refunded_at is not null
  union all
  select 'refund_operations' as source, restaurant_id, stripe_payment_intent,
    fee_verification_pending, fee_reconciled_at
  from refund_operations where source = 'stripe' and status = 'succeeded'
)
select source,
  count(*) filter (where fee_verification_pending and fee_reconciled_at is null
    and not public.refund_fee_proven_clear(restaurant_id, stripe_payment_intent)) as still_pending,
  count(*) filter (where fee_reconciled_at is not null
    or public.refund_fee_proven_clear(restaurant_id, stripe_payment_intent)) as verified_or_clear
from completed group by source;
```

### Finding 4 — a saved request outlived the amount it could return

Recovery first searches every page of the original attempt's provider evidence,
then reads the fee again. A completed attempt can advance toward a larger target.
An unseen attempt can advance only when its amount exceeds the entire fee still
available at Stripe: even a delayed worker cannot apply that old request. If an
unknown request could still land against a partial target, it stays pending.
Each retired request and its evidence stay in `fee_request_history`; the next
request is saved under the money lock with a comparison to the exact old request.
The first Stripe key and metadata stay compatible; later attempts have their own
number, key and metadata. MX$100 / US$100 with 300 cents owed and 100 separately
returned now returns 200 exactly once, including after a lost response.

Changed SQL functions: `finish_refund_operation`, `finish_refund_due_attempt`,
`sync_refunded_platform_fee`, `guard_return_money`, `admin_delete_restaurant`.
The immutable-money trigger permits the two new fee metadata fields while
still protecting every amount, currency and original charge identity. New functions:
`verify_refunded_platform_fee(uuid, text, int, int, text[])`,
`advance_refund_due_fee(uuid, uuid, jsonb, int, int, int, text)`,
`refund_fee_proven_clear(uuid, text)`. Existing signatures remain callable;
the old sync only updates the fee ledger, leaving operation completion to the
new verified-target function. New definers use the existing service-only grants
and fixed search path; `drop.sql` includes every new function.

Claude applies `schema.sql`, runs all shared-database gates, and checks both
deletion refusals on screen. No shared database or live provider was used for
this fix; Vitest mocks their boundaries.

## Collection feedback: partial payments and refreshing open bills

Pedidos marked a payment request done after the first part, hiding its Collect
button while the table still owed money. The server already closes that request
when all debt is settled; the screen now refreshes that result without marking
the request done itself. Open bills also disable both row actions and show an
updating state between a confirmed collection and the refreshed server list.
Partial balances become actionable again; fully paid rows leave the list.

`collection-progress.react-component.spec.tsx` reproduces both bugs and checks
request retention, server-confirmed removal, both disabled row actions and the
remaining balance after a partial collection.

## Attack fixtures must leave the drawer consistent

The attack suite deleted its MX$200 and MX$150 full-collection test payments,
but its cleanup still searched activity details for the table label. The newer
reviewed collection writes amount, tip, currency and method without that label,
so two test activity rows remained and the next money check found a false
MX$350 surplus in the waiter's corte. The gate's earlier money check had run
before those attacks and could not catch their teardown.

`attack-collection-logs.mjs` captures only the newly created activity IDs around
those two operations, scoped to the fixture restaurant, collector and exact
detail. It remembers a landed write even when its response is lost, refuses
ambiguous/failed reads, and checks exact-ID deletion. `attack-logs.react-component.spec.tsx`
checks those boundaries. The attack gate now reconciles money after cleanup,
so leftover test records fail that same run. Production accounting and the
application's collection writer are unchanged.

## Written-off orders must leave preparation

Three historical orders kept `received` after being written off. The initial
board, realtime rendering and badge counts treated that source status as active,
but the API correctly refused the buttons it offered. Kitchen tickets also copied
the live status. A station tap reached the final-state database trigger and errored.

The floor feed and counts exclude write-offs; the private projection emits an
inactive status. Station completion refuses write-offs under the same order lock.
Stale stage/station refusals retire only the preparation card, preserving source
orders and revenue. `inactive-orders.react-component.spec.tsx` exercises actual
React state, realtime removal, stale taps, normal stages and retained takings;
`inactive-order-moves.react-component.spec.tsx`, kitchen query tests and
`api-inactive-orders.mjs` cover role/tenant guards, private tickets and no-write
refusals against the live development database.

## Availability saves must preserve confirmed rows and click order

Every availability switch reloaded the complete menu to protect the latest
snapshot and concurrent reads. Successful ordinary switches now return and patch
the complete saved item, including stock and the actual available flag. Both
rendered state and the copy/reorder snapshot agree before the save resolves.

Per-item queues survive renders and preserve the latest visible intent while
saving each click in order. Different items remain independent. A full read
started during the write, changed grouping or a failed/ambiguous response still
uses a complete reconciliation; older reads cannot undo the confirmed result.
Changing restaurant or unmounting retires queued work and late responses. RLS,
restaurant filtering and zero-row refusal checks remain on every save.

`availability.react-component.spec.tsx` and `availability-races.react-component.spec.tsx`
exercise the actual React hook: products/extras, returned stock, immediate copy,
click ordering, cross-item saves, overlapping reads, failures, retry readiness and
editor lifetime. Against the original availability action 11 cases failed; all
22 cases pass with the row patch and queue.

### The scanner's fallback decoder loads when a camera needs it

jsQR was imported at the top of `useQrCamera`, so every diner's menu carried
it through `MenuScanButton`, whether or not anybody scanned anything. It now
loads only with the camera open, on a browser without the native
`BarcodeDetector` (Safari, the restaurant's iPads). If that load fails, the
camera stops and the dialog says it cannot read, instead of showing a lens
that never will. `qr.spec.ts` fails on a static import.

### Audit M (Claude): today's takings doubled on refresh; an rls check that could skip

- **Finding 2.** The orders board shows today's takings as the server's base
  plus the paid orders in its live list. The live list was seeded once, so
  after `router.refresh()` a completed MX$100 order the base now counted was
  still in the list: MX$200 shown for MX$100 paid. Each new server snapshot
  now replaces the list. Tested in `orders-snapshot.spec.ts`.
- **Finding 3.** The cross-tenant collection checks in `rls-check` sat inside
  `if (theirTable)`, so a failed lookup skipped them silently. They build
  their own tables, so they now always run. A failed read, or a neighbour
  with no table, fails the check.

## Audit M finding 1 — fee recovery and its final provider check must agree

| Rule | The bug it came from | What checks it |
|---|---|---|
| A duplicate-charge fee completes only when the final verified target is returned | A manual MX$90 / US$90 refund between provider reads raised the fee target from 30 to 300 cents, but recovery hid the remaining 270 cents and deletion let it through | `fee-recovery-target.spec.ts` in MXN and USD; `fee-recovery.spec.ts` |

Recovery used to verify the provider again, then overwrite that result with an
unconditional completion timestamp. `verify_refunded_platform_fee` now saves
the due row's final cumulative target, pending flag and completion time under
the same money lock as deletion. Only completed customer refunds seen in the
provider snapshot are covered; a verified charge without a fee records zero.
A short return clears completion and stays visible to Bills recovery. The caller
reads this saved outcome instead of deciding completion from its earlier target.

The failing-first MXN and USD cases reproduce a 100 charge, 3 fee and 10 customer
refund, followed by another 90 customer refund during fee recovery. They now keep
300 cents targeted and 30 returned pending, then return the remaining 270 exactly
once with the existing numbered request and Stripe key. Existing lost-response,
concurrent-retry and unknown-request tests remain covered; failed final writes
and unreadable outcomes cannot report success.

Claude applies the idempotent replacement of
`verify_refunded_platform_fee(uuid, text, int, int, text[])` from `schema.sql`;
no signature, grant or drop-list change is needed. Then run the shared-database
gates and check that Bills retains the pending fee and deletion refuses it until
recovery finishes. No shared database or provider was contacted for this fix.

## Gate sessions and promise sweep readiness (roadmap #5)

| Rule | The bug it prevents | What checks it |
|---|---|---|
| HTTP and browser gates encode the same project session | Separate cookie builders drift, or encode a missing session and audit the login screen | `session-cookie.spec.ts` |
| Promise sweeps audit resolved browser data | A 1.8-second sleep reports a skeleton as an honest empty screen before slow data arrives | `promise-readiness.spec.ts`, `browser-ready.spec.ts` |

Six permitted harness files now use `session-cookie.mjs` for the existing
project cookie name and base64 session encoding. Browser cookies and HTTP
headers share that encoding; missing sessions fail before a visit. The RLS
harness is held by PR #542 and deliberately keeps its existing builders until
its owner adopts the helper.

The team and diner promise sweeps track requests before navigation and use
`ready`, which polls through `observe` until content, data and layout settle.
Both regression cases first reproduced a false pass at 1.8 seconds with data
arriving at 2.5 seconds; now every visit waits and reports the missing message.
All original case lists, visits and verdict assertions are preserved: 54
planned sweep visits and 54 development state cases, plus dynamically found
dashboard links. Production continues to omit the writing state cases.

## Roadmap #13 — splitting checks must preserve their inventories

| Rule | The bug it prevents | What checks it |
|---|---|---|
| API route coverage follows the case index and rejects unimported parts | Moving cases out of one source file could leave a route unchecked while the suite stays green | `invariants/gates.spec.ts`: `has an api case for every API route` |

The subject suites in `src/lib/__tests__/invariants/` share their file readers
and walkers. `scripts/api-cases.mjs` assembles the area modules in the original
order, retaining the fixture-taking interface and shared collection retry state.
The route inventory reads imported parts; an extra part cannot silently cover a
missing case. Removing the `/api/session` case, adding an unimported part and
removing a part's index import each failed that invariant, then passed restored.

### Audit N (Codex): a stale fee check could finish what a newer one left owed; a late camera stayed on

- **Finding 1.** Two fee verifications read Stripe in one order and took the
  money lock in the other. The older one wrote its smaller target over the
  newer one's and marked the row done: MX$2.70 of our fee owed with nothing
  left to say so. `verify_refunded_platform_fee` now keeps the target and the
  amount returned as high-water marks, the way `advance_refund_due_fee`
  already did, and the TypeScript save of a target only ever raises it.
  Pinned in `fee-recovery-target.spec.ts`; replayed on real Postgres in dev,
  rolled back, MX$ and US$.
- **Finding 5.** Closing the scanner while the browser was still granting the
  camera ran cleanup before there was a stream, and the stream that arrived
  afterwards was never stopped. `qr-camera-late-stream.spec.ts`.
- **Finding 2** (a legacy `charge_already_refunded` row with no refund id
  pending for ever) needs no change: today's path refuses without an id, and
  production has none (counted 2026-10-27).

### Audit N (Codex): "today" on the orders board missed money; a refresh dropped live orders

- **Finding 4.** The board's "today" added up paid orders created today. A
  MX$50 collection on a MX$100 order, a paid split share and yesterday's
  account order settled today are all money in the drawer, and all read as
  MX$0. It now reads `collectedToday`, which is the corte's own figure (the
  ledger since the restaurant's midnight, net of completed returns), so the
  two screens cannot disagree. `collected-today.spec.ts`, MX$ and US$.
- **Finding 3.** #542 replaced the live list with every server snapshot to
  keep the old order-sum from counting twice. A snapshot is read before it
  renders, so an order or a move realtime delivered in between disappeared.
  With takings off the list, the list is seeded once again and realtime keeps
  it current. `orders-takings.react-component.spec.tsx` fails with the
  replacement put back, and also pins audit M's MX$200-for-MX$100.

### Audit O (Codex): a refund Stripe failed later stayed shown as returned

- **Finding 1.** A card refund can fail days after Stripe first says
  succeeded (a closed card, a bank that returns it). Nothing listened, so the
  diner's money stayed shown as returned on Bills, in the corte and to the
  deletion checks. The Connect webhook now handles `refund.failed`,
  `refund.updated` and `charge.refund.updated`. `reverse_failed_refund`
  returns the row to the failed state the app already offers to retry, and
  logs `refund_failed` for the owner. **The Stripe endpoint must be
  subscribed to those events** (external setup), or nothing arrives.
- **Finding 2.** #546 made the fee target a high-water mark, which a failed
  refund legitimately lowers. The reversal clears every fee target on the
  charge, so the surviving refund re-verifies against the lower target
  instead of staying pending and blocking deletion.
- `provider-failure.spec.ts`. Replayed on dev Postgres, rolled back, in MX$
  and US$: failed and retryable (attempt 2), a repeat reopens nothing, the
  sibling re-verifies 300 → 30 and is done, the refunds-due row is owed and
  retryable again.

## Audit O finding 5 — imported API groups must reach the runnable list

| Rule | The bug it came from | What checks it |
|---|---|---|
| API coverage follows returned cases, and every part export must be registered | Removing the cash spread silently dropped 16 cases while imported route strings still counted as coverage | `invariants/gates.spec.ts`, `api-case-registration.spec.ts` |

Route coverage now builds the real case list once with an in-memory fixture and
resolves its string and function paths. It never runs fixture setup or case
callbacks. Import registration also checks every factory against the spreads in
the returned array and every part export against named imports, including the
shared helpers. Cash routes overlap other groups, so route coverage alone cannot
prove those 16 cases still run. Removing a spread, removing an import (even with
its spread), or adding an unused part export now fails; restoring them passes.
The runnable inventory remains 303 cases with identical names and order.

## Audit O findings 3 and 4 — live takings and refreshed tickets must catch up

| Rule | The bug it came from | What checks it |
|---|---|---|
| Restaurant takings refresh independently of paid order ids | Another till's partial collection, a split share or a return left today's figure unchanged | `orders-live-takings.spec.tsx`, `orders-money-actions.spec.tsx`, `orders-takings-route.spec.ts`; manager success and three `expectError` refusals in `api-cases/orders.mjs` |
| Snapshots repair missed events without discarding newer work | A missed ticket or station move stayed missing after refresh; replacing the list instead erased intervening realtime events | `orders-snapshot-recovery.spec.tsx`; audit N's existing `orders-takings.react-component.spec.tsx` |

### Finding 3: the board and the ledger need an independent refresh

The paid-id fingerprint could not see partial collections, split shares or a
refund of an already-paid order. A manager-only, membership-scoped takings read
now reuses `collectedToday` unchanged. SWR retains the page's initial figure,
polls every 30 seconds while visible, and revalidates on focus and reconnect.
Live paid, cancelled and total changes invalidate it, as do the board's own
successful collect and cancel actions. Read failures retain the last figure.
Kitchen, waiter and cashier never mount this read; the route refuses them
before accessing money. Tenant, currency and midnight come from membership.

### Finding 4: refresh must merge both preparation feeds

Neither orders nor kitchen tickets has a usable updated-at column. The page
stamps the start of its snapshot read. Reconciliation compares realtime commit times and HTTP reply dates against that
server read, so a tablet's incorrect clock cannot erase newer work. It adds missed tickets,
repairs stages and station readiness, and removes missed completions while
keeping realtime rows received during that read. Older refresh responses cannot
undo newer ones. In-flight optimistic moves stay protected until their requests
finish; saved offline paths keep their final visible step. No per-order reads
are added. A failed snapshot query cannot erase the current list.

Both findings failed first in `orders-live-takings.spec.tsx` and
`orders-snapshot-recovery.spec.tsx` (12 failures). Claude owns shared database
gates and integration; this worker uses only local mocked/unit checks.

### Audit P (Codex): a refund failure could be overwritten, replayed or verified against stale evidence

#548 trusted Stripe's events to arrive once and in order. They don't.
- **Finding 1.** A "succeeded" read already in flight could land after the failure webhook and complete the refund again: MX$100 owed, shown as returned. Both finish functions now refuse a success for a refund in `refund_failures`. An old attempt's first-seen failure no longer reopens a row whose retry is already in flight: only the latest attempt's refund does.
- **Finding 2.** Clearing every fee target on each failure let a replay erase a newer target, and let a verification from before the failure re-raise an obsolete one for good. Each failure is now recorded once, so a replay is a no-op. It also moves the charge's fee epoch on, and `verify_refunded_platform_fee_v2` refuses a snapshot read under an older epoch.
- **Finding 6.** The owner's activity line was a separate insert after the reversal had committed. If it failed, a replay found nothing to reopen and never logged it. It is now written in the same transaction.
- `provider-failure.spec.ts` and `fee-verification.spec.ts` pin each rule. Replayed on dev Postgres (rolled back), in MX$ and US$: a late success is refused in both books; an old attempt reopens nothing; a stale verification is refused while a current one is accepted; a replay keeps the epoch and the sibling; the log line appears once.


## Audit P findings 3, 4, 5 and 7 — board responses and their local evidence must agree

| Rule | The bug it came from | What checks it |
|---|---|---|
| Takings identify the restaurant and currency that earned them | A membership change let B's US$250 appear as A's MX$250 | `orders-takings-identity.spec.tsx`, `orders-takings-response.spec.ts` |
| Remembered order timestamps only increase | A delayed HTTP reply lowered a newer realtime timestamp and let a stale snapshot erase ready | `orders-snapshot-watermark.spec.ts` |
| Successful moves repair the local ticket even without their final realtime event | Received → preparing → ready replay emptied the queue but left preparing visible | `orders-move-ack.spec.tsx` |
| Every API case resolves to an API path without arranging live fixtures | A cloudprnt case requested `undefined?token=undefined&code=OK` in inventory while other cases hid the coverage hole | `invariants/gates.spec.ts`, `print-delivery-path.spec.ts` |

### Finding 3: the response and the mounted board name the same money

The membership-scoped route returns `restaurantId`, `currency` and the ledger
figure. The board rejects a mismatched identity, currency or invalid amount,
keeping its last successful figure. Restaurant and currency are part of its
SWR key, and only a manager mounts it. Claude left the root layout alone: its
proposed change wrapped every page, the diner's menu included, in the
dashboard cache, and the validation above already refuses another
restaurant's figure.

### Finding 4: a delayed reply cannot lower newer evidence

`remember` keeps the maximum timestamp. A delayed reply can finish its active
move without erasing a newer realtime commit time, so a snapshot begun between
them cannot replace the newer ticket. The snapshot's `Date.now()` and database
commit time are both server clocks; comparing them is acceptable. The tablet's
clock does not replace either server timestamp.

### Finding 5: a sent move and the ticket's visible stage agree

Both queued and live successful moves reapply their destination when the ticket
still shows the source stage. This repairs an intermediate event that overwrote
the optimistic stage, while retaining a later stage already received live or
requested locally. Refusal handling and retry queues retain their existing rules.

### Finding 7: route coverage cannot hide a malformed inventory entry

Inventory validates every resolved path's type and `/api/` prefix before
matching routes, without calling arrange or any request callback. The cloudprnt
race case now names its route directly from the printer fixture instead of an
arrange-only variable. Its old delivery token still comes from arrange and its
reprint checks stay intact. The runnable inventory remains 307 cases.

### Audit Q (Codex): four ways a failed refund could still read as returned

- **Finding 1.** Refunds completed before attempts existed have no attempt row,
  so #551's reversal never found them. A failure left `refunded_at` set, and
  deletion could pass with MX$100 owed. Rows without attempts are now matched
  by their own refund id.
- **Finding 2.** A failure that arrived before the attempt knew its refund id
  made both finish functions refuse everything, so retries reused that attempt
  for ever. A stale success also left `refundDue` reporting "refunded". The
  finish functions now record the known failure on the attempt and don't
  complete it: a retry opens a new attempt. `finish_refund_operation` returns
  false for it, and `refundDue` answers `refundPending` unless the row really
  completed.
- **Finding 3.** #548's unversioned verifier stayed callable without an epoch.
  It now refuses once a charge has seen a failure. The fee write itself lives
  in `apply_verified_platform_fee`, which is granted to no one.
- **Finding 4.** A recovery saved its provisional fee target with a direct
  update. It now goes through `save_refund_due_fee_target`, which is
  epoch-checked and only ever raises the target.
- `provider-failure.spec.ts` and `refund-due.spec.ts`. The `refundDue` test
  fails without its fix. Replayed on dev Postgres (rolled back), in MX$ and
  US$, all four paths hold.

### Audit R (Codex): a fee request read before a failure could still be sent

- **Finding 1.** Fee recovery opened a first attempt for a refund completed
  before attempts existed, but without that refund's id. A later failure then
  matched neither the attempt nor the legacy fallback, and the diner stayed
  owed. `start_refund_attempt` now gives that first attempt the operation's
  own refund and outcome.
- **Finding 2.** `start_refund_due_fee` and `advance_refund_due_fee` accepted an
  amount read before a refund on the charge failed, and could ask Stripe for
  MX$2.70 of fee nobody owed. Their bodies are now internal `*_apply`
  functions granted to no one. The recovery calls epoch-checked `*_v2` entry
  points; the kept ones refuse once the charge has an epoch.
- `provider-failure.spec.ts`. Replayed on dev Postgres (rolled back), in MX$
  and US$: the legacy refund reopens after recovery; a stale start, the old
  entry point and a stale advance are all refused; only the current-epoch
  amount is requested.

## Audit S finding 2 — keep refund recovery available for 30 days

| Rule | The bug it prevents | What checks it |
|---|---|---|
| Deletion waits 30 days after the latest successful Stripe refund evidence | A refund failed after deletion, but its restaurant and live recovery path were already gone | `restaurant-delete-refund-window.spec.ts` |

`admin_delete_restaurant` now returns `refundWindow` and `unlock_at` under
the existing money and restaurant locks, before either readiness or archive
writes. It uses the latest successful Stripe operation's `completed_at`,
duplicate-payment return's `refunded_at`, or successful attempt's `updated_at`
in either refund book. At exactly 30 days the window ends; the existing checks
for unfinished money still apply. Cash and terminal operations do not open
this window. English and Spanish refusals explain why and show the UTC unlock
time; both the first route check and the final atomic check map it to HTTP 409.

The failing-first spec pins all four tenant-scoped SQL sources, the maximum
timestamp, strict 30-day comparison and lock/write order. Mocked RPC cases cover
a 29-day refusal and 31-day clearance in MXN and USD, bilingual copy and a new
hold appearing at the final deletion check. These are source and route checks,
not a Postgres replay. Claude applies the unchanged-signature function and
replays 29, exactly 30 and 31 days for each source, latest-of-several evidence,
another restaurant and non-Stripe operations, then runs the serial release
gates and checks both messages on the admin screen.

## Audit S finding 4 — retire the incremental fee refund writer

| Rule | The bug it prevents | What checks it |
|---|---|---|
| The legacy incremental writer has no service or client execute permission | Inferred returned fees could bypass provider evidence and the failure epoch | `retired-refund-platform-fee.spec.ts`; the replacement case in `attack-fees.mjs` |

`refund_platform_fee` stays defined with its original explanation, but its
execute privilege is revoked from `service_role`, PUBLIC, anon and
authenticated. Reapplication removes the old service grant too. No application
caller needs it; retaining the function avoids a drop while making the retired
entry point unusable to the service. `drop.sql` already lists its signature.

The fee-ceiling attack now requires permission denial (`42501`) and a readable,
unchanged returned-fee balance. A successful call, unrelated error or changed
ledger fails. The group still emits four verdicts: one old retry verdict is
replaced by one retirement verdict. Its mocked execution and grant assertions
failed before the fix and pass after it. Claude applies the revoke and runs
the real attack with the other shared-database gates; this worker made no
database or provider calls.

## Audit S findings 1, 3 and 5 — charge fee returns and duplicate-refund coverage

| Rule | The bug it prevents | What checks it |
|---|---|---|
| Every fee dispatcher uses one charge revision and immutable request key | Two snapshots return the same share twice, or an absent provider object authorises another unknown POST | `charge-contract.spec.ts`, `fee-recovery.spec.ts`, MXN and USD |
| Duplicate-payment completion retains every contributing refund and amount | A partial return or a later failure is shown as fully refunded | `coverage-contract.spec.ts`, MXN and USD |
| Successful Connect refunds enqueue before acknowledgment; recovery acknowledges only its starting generation | A later manual Stripe refund is never repaid, or a newer enqueue is erased | `discovery-contract.spec.ts`, `charge-contract.spec.ts`, MXN and USD |

The duplicate-charge and order-refund paths now share `charge-reconciler.ts`.
It reads the revision before Stripe, verifies cumulative provider amounts,
prepares and claims the immutable fee request, then posts with the saved key
and `fee_return` metadata. It records positive evidence and verifies a fresh
snapshot before acknowledging the queue generation read at the start. Both
customer refunds and application-fee refunds use Stripe's paginated iterators.
Unknown requests are never replaced from absence: reclaim uses the same key
inside the SQL window, and unresolved rows need positive matching evidence
from the complete provider listing. A zero remainder can supersede a never-sent
request without dispatching a zero refund.

`refundDue` passes refund IDs with their amounts to the coverage-aware finish
RPC. Partial and failed outcomes answer `refundPending` without logging or
reporting a completed refund. Coverage remains available across retries, so a
failure of an earlier contributor cannot disappear behind the latest attempt.
The Connect webhook durably discovers successful manual refunds even after
all local operations reconciled. Queue recovery uses the charge's saved account;
without original account evidence it retains the queue entry for review.

The contract regressions fail against the baseline TypeScript and pass with
mocked RPCs following the agreed contract. Claude owns SQL integration, the
Postgres concurrency/coverage replays, Connect event subscriptions and serial
release gates. These local tests do not apply or validate the deployed schema.

## Sections round 1 — refreshes must preserve the person's state

| Rule | The bug it came from | What checks it |
|---|---|---|
| A scanned URL opens collection once, independently of later bill snapshots | A bill refresh reopened the collection the cashier had dismissed | `bills-scan.spec.tsx` |
| Failed history reads retain the last rows and offer retry | A failed page read replaced successful sales with an empty list | `sections-read-errors.spec.tsx` |
| Staff and profile read failures remain errors, with the previous team retained | A failed staff read looked like an empty team; a failed profile read erased names | `sections-read-errors.spec.tsx` |
| A part-paid bill is never written off, directly or by approval | MX$80 of a MX$100 bill collected; a manager wrote it off and the log said MX$100 lost | `table-adjustments.spec.tsx` (route + SQL text), dev probe of `write_off_orders` |
| A locked plan freezes every table the menu editor writes directly | Sections, extras, icon palettes and dietary tags stayed editable on a locked plan | `invariants/database.spec.ts` (every "manages" policy has a freeze trigger), dev probe |
| A shift opened during a close starts after it | An open waiting on a close kept its transaction-start time, so one sale fell in both shifts | `cash-shift-open.spec.ts`, dev probe of `open_cash_shift` |
| A staff discount lands whole or not at all, and never under collected money | Totals written with no lock, failed writes ignored, redemption logged anyway; a part-paid bill cut below what it had paid | `table-adjustments.spec.tsx`, dev probe of `apply_bill_discount` |
| Repricing service decides and writes under the money lock | A collection between the read and the write; the stale write lowered a total with money against it | `service-reprice.spec.ts` (rules in the SQL), dev probe of `reprice_open_service` |
| The allocation guard checks every order writer, not only those that opt in | Three direct writers lowered or forgave covered orders past an opt-in guard | `allocation-review.spec.ts`, `allocations-check.mjs` (non-opted-in writes refused; a status move allowed) |
| A refund made by hand in Stripe counts toward the due, and the rest is asked for capped | MX$40 returned by hand; every retry asked for MX$100 and answered 502 for ever | `refund-due-partial.spec.ts` (MX$ and US$), `refund-due-manual-schema.spec.ts`, dev replay |
| Failed activity reads retain the last page and offer retry; search text stays inside its filter | A timeout erased activity behind "no activity"; a comma or parenthesis broke the raw search filter | `user-logs-read-errors.spec.tsx` |

### A scanned collection and a refreshed bill list have separate lifetimes

Bills consumes each arriving `order` query value once. Live server snapshots
still update the bill list, but cannot reopen a dismissed collection or repeat
a missing-code warning. Scanning again with the camera still opens collection;
navigating away from the query and back can consume a new arrival. Matching
continues to use only the server's restaurant-scoped bills. Collection routes,
amounts and role/plan guards are unchanged. Claude checks Bills for collecting
roles with the dialog, layout, role and money gates during integration.

### History and Staff can have useful rows and a read error together

Both readers reject Supabase errors and let SWR retain successful data while
reporting failure. Retry revalidates the failed read. History keeps its rows
and count if a page fails; the successful response's restaurant identity
prevents previous rows crossing restaurants. Staff publishes a list only after
both staff and profile reads succeed, so unknown names do not look like blank
profiles. An empty successful staff read skips profiles. Invitations remain
successful if only the following list refresh fails, avoiding duplicate invites.
Role edits and removals update the same cache. Existing bilingual network-error
and retry copy is reused; no translation keys change. Claude checks analytics
pagination, Staff invitations/roles and error/retry layout at integration.

### Correction to the historical `creditFor` reference above

The earlier "Money on a sitting, spent twice" section describes the helper
used at that time. The live reader now uses `paymentCoverageDetails` and sums
coverage for the unpaid orders; it no longer calls `creditFor`. Sections round
1 removes that unused helper and its own tests. Allocation and outstanding
currency tests continue to cover the live reader. The earlier history remains
as written. No balance calculation or payment writer changes in this cleanup.

The cleanup also removes unreachable inline menu forms (every caller used
modals), unused exports and tests that exercised only retired helpers. The
live `sharesFor` tests still check that every cent adds back to the bill.
`EMPTY_CORTE` remains in each consuming test as a fixture. `nextPlan` and its
existing tests/documentation remain because `plan.ts` belongs to other work.

## Approved features round 1 — search, pending sales and diner paper receipts

| Rule | The bug it prevents | What checks it |
|---|---|---|
| Shelf searches retain typed counts and prioritise unknown/negative stock | A filter hid an unfinished count or changed the count submitted after a lost reply | `stock-count-search.spec.tsx`, existing `pending-forms.spec.tsx` and `costs-counts.spec.ts` |
| Coupon filters share the server's exact date boundaries | A code refused at its end time still appeared active, or a future code vanished from expired | `coupon-search-filters.spec.tsx`, existing coupon service tests |
| Pending sales and approved history have separate reads and caches | History buried unapproved money, inflated the pending badge or reloaded every 30 seconds | `held-sales-history-route.spec.ts`, `held-sales-pending.spec.tsx`, existing offline recovery/upload tests |
| Print/save uses the same receipt renderer as email and POS | A saved document changed the currency/discount/tip or falsely recorded an email as sent | `receipt-print-route.spec.ts`, `receipt-print-prompt.spec.tsx`, existing receipt/print/POS tests |
| An emailed receipt never adds two currencies | MX$100 and US$10 from one restaurant were sent as MX$110 | `receipt-print-route.spec.ts` |

### Stock and count search

Owner/manager stock and CountDialog search names without changing the underlying
ingredient list. Unknown and negative stock sort first, then names. Counts stay
blind: expected figures appear only after saving. A nonempty typed row stays
visible through a search, and retry requests retain their original reference,
units and counts. Ingredient editing, purchases, waste, stock valuation and
server write/plan guards use their existing paths.

### Coupon search and filters

Owner/manager coupons search case-insensitive codes. Paused has its own view;
otherwise the server's date guards decide expired: start later than now or end
at/before now. Future starts are explained in both languages, and open screens
update at the next date boundary. Usage limits/minimum spend remain separate
refusal reasons; spent badges, create/edit/pause/delete, diner checkout and
staff discounts retain their existing pricing and authority paths.

### Saved sales pending first

The manager-only recovery GET defaults to all unapproved rows, scoped on every
read to the acting restaurant. Approved history orders by approval time and a
unique reference, reads 20 rows plus a next-page sentinel, and refuses invalid
page numbers. SWR keys separate restaurant, view and page. Pending alone polls
every 30 seconds and supplies the pending badge even while history is open;
local device-held receipts remain separately labelled. Approval POST, original
amount/currency/collector checks, cashier upload and offline drawer guards stay
on their existing paths. Failed reads never masquerade as an empty queue.

### Print or save the diner's receipt

The existing receipt POST accepts print delivery without an email. It uses the
same buildReceipt HTML and printableReceipt stylesheet as POS, plus the existing
printWhenReady policy-safe window handling. Printing gets its own per-order
quota and neither sends email nor writes receipt_sent_at. It requires the full
requested paid bill from one restaurant/table/currency. The window opens during
the click so phones can allow it; failed/aborted reads close the blank window,
and blocked popups get an explanation. Email remains available after failure.

Claude owns the live checks: API (including new GET history and POST print
modes), roles/RLS, promises (freeze/downgrade and failed reads), money/attack,
smoke, layout and dialogs, serially against the integrated checkout. At 360,
390, 820 and 1280 px inspect both languages: stock search/no match and priority
order; CountDialog with a typed row retained while filtering and after a lost
reply; coupon search/status controls and all date states; pending/history badge,
pagination, cashier upload and manager approval; diner email/print before and
after email success. Print-preview/save PDF on mobile Safari and desktop with a
single order and whole paid table, MXN/USD, discounts, service and tips. Compare
the same receipt's POS print and email. This worker runs no servers or live
gates and makes no schema changes.
## Paths audit 1 — onboarding and open checkouts keep the same merchant

| Rule | The bug it prevents | What checks it |
|---|---|---|
| An unread Connect account stays an error, and only an empty account field may be filled | A read failure or two onboarding calls replaced the merchant and stranded open diner checkouts; Settings called a failed status read disconnected | `stripe-connect-read.spec.ts`, `stripe-connect-payments.spec.tsx`, `stripe-connect.spec.ts` |
| A part-paid walkout writes off only what nobody paid | #564 refused it outright, so a table that paid MX$80 of MX$100 and left could not be closed | `table-adjustments.spec.tsx`, `write-off-remainder-schema.spec.ts`, api case, dev replay |

`readConnect` throws on a failed read before asking Stripe for another account.
The first account is saved only while `stripe_account_id` is null, with returned
rows proving the save. A losing call reads and uses the winner's saved id; a
failed save or re-read stays an error. Its unused Stripe account is left for
separate cleanup, so a cleanup failure cannot prevent onboarding the saved one.
The onboarding route keeps its existing error response. Status now returns the
existing generic error, and Payments shows that failure without the disconnected
prompt. The owner can still resume onboarding. Existing English and Spanish
copy is reused.

The failing-first tests mock the database and Stripe; they do not replay a
Postgres race. Claude runs the serial integration gates and checks failed status
requests and onboarding in Settings in both languages before release. No schema
or function signature changes are needed.
## A bill written off with the money already in it (paths audit #5)

`applyWriteOff` was a plain update that checked `paid = false` and nothing
else. A bill with MX$80 of MX$100 already collected was written off and logged
as MX$100 lost, while the MX$80 stayed allocated to an order nobody owed any
more. It also got past `guard_allocated_order`, which only checks writers that
set `tabletap.allocation_writer`. The approval path did set it, so the same ask
raised a database error there instead: two routes, two answers, neither one
explained.

The direct write-off now runs in `write_off_orders`, under the money lock. It
refuses a part-paid bill with the amount paid, and the route logs what the
database actually wrote off. A waiter's ask is refused for the same bill before
it is stored, and an approval for a bill paid in part since the ask returns
`part_paid` instead of raising. Forgiving only the rest of a part-paid bill is
a separate operation, not built.

## A read-only dashboard that still renamed sections (paths audit #10)

On a locked plan the dashboard says it is read-only, and the database refuses
management writes to menus, items and tables. The same editor also writes
sections (`categories`), extras (`item_addons`), icon palettes and dietary tags
straight to Postgres, and none of those were frozen, so a manager could still
rename a section. All five now carry the freeze trigger. `item_addons` and
`icon_group_items` have no restaurant of their own and find it through the
parent row. An invariant now fails on any table with a "team/owner manages"
policy and no freeze trigger, unless it is listed with the reason it stays
writable.

## One sale in two shifts (paths audit #6)

Closing a shift takes the money lock and stamps `clock_timestamp()`. Opening
one was a plain insert whose `opened_at` defaulted to `now()`, the start of its
own transaction. An open that started at 12:00:00 and waited on the one-open
index for a close committing at 12:00:01 kept 12:00:00, so a sale at
12:00:00.5 fell inside both windows and the corte counted it twice. Opening is
now `open_cash_shift`: the same lock, then the time. Found by reading, not
seen in production; the interleaving was not run.

## A discount that said yes whatever happened (paths audit #2)

A manager's staff discount was written from `apply-bill-discount.ts` order by
order: the coupon use first, then each order's total with no lock and no check
of the result, then the redemption, logged and reported as done whatever the
updates did. A bill with MX$80 of MX$100 collected could be cut to MX$50 under
the money already in it, and a refused update still logged MX$50 redeemed. It
also got past `guard_allocated_order`, which only checks writers that opt in.
`apply_bill_discount` does it in one transaction under the money lock: the
coupon use, the totals and the redemption, or none. It refuses a part-paid bill
the way a write-off is refused. An approval for a bill paid in part since the
ask now answers `part_paid` instead of raising. Both bill routes also stopped
reading a failed order read as an empty bill.

## A service charge taken off a bill that had just been paid into (paths audit #4)

Switching the service charge off lowers it on bills nobody has started paying.
The rules were right, but they ran in two steps: read which bills were promised
to somebody, then write each one guarded only on its old service charge. A
waiter collecting MX$100 plus a MX$10 tip in between left the order at MX$120
with MX$110 allocated, and the stale write set the total back to MX$100 with
the money still against it. `reprice_open_service` now reads and writes in one
transaction under the money lock, with the same rules, plus retained coverage
checked directly.

## A guard that only guarded writers who asked (paths audit #2, #4, #5)

`guard_allocated_order` refuses changing an order that has money against it
without the matching adjustment. It returned at once unless the writer had set
`tabletap.allocation_writer = 'v1'`, so the three direct writers above were
never checked, and the legacy `cancel_order` can still cancel a covered order
with no refund obligation. With those three moved into locked functions, the
guard now checks every writer (Codex found the `cancel_order` case; agreed in
the dialogue). An update that changes nothing it protects, such as the kitchen
moving a ticket along, returns before the coverage read. `check_paid_coverage`
stays gated as it was. The api gate's allocation checks now try the refused
writes without the flag.

## A duplicate-charge refund stuck behind a manual one (paths audit #7)

A MX$100 duplicate-charge due, of which the restaurant had already returned
MX$40 from Stripe's dashboard. Every retry asked Stripe for the attempt's full
MX$100, Stripe refused anything above the MX$60 left, the MX$40 was never
recorded, and the due answered 502 for ever. Before asking for anything,
`refundDue` now reads the charge. The restaurant's untagged succeeded refunds
are recorded as coverage (`record_refund_due_coverage_v1`), which never touches
our own attempt. A new attempt is capped at what the charge still has
refundable (`start_refund_due_attempt_v2`). An attempt left from before, now
too large, is retired only on Stripe's own "more than is left" refusal, which
proves nothing was created, and replaced once from a fresh read. Contract
agreed with Codex in the dialogue (topic refund7). Codex wrote the failing
tests; Claude wrote both halves.
### Paths audit 9 — the activity read and its empty state must agree

A failed activity query used to replace the last rows and count with an empty
page, so an owner saw "no activity" or "no matches" after a timeout. The hook
now keeps its last successful page within the same restaurant, reports returned
and thrown read errors, and retries the current search, sort and page. Rows
stay visible while a replacement loads, and a late response cannot replace a
newer read. A successful empty result still shows the normal empty message.

Activity search now uses order history's `filterValue` helper: commas,
parentheses, quotes and backslashes belong to the searched value, not extra
PostgREST conditions. Existing English and Spanish network-error and retry
copy is reused. `user-logs-read-errors.spec.tsx` checks these cases with mocked
reads; Claude checks the owner activity screen and shared gates at integration.
The hook keeps its existing fetching approach in this fix. A later SWR
migration would align its caching and revalidation with the other readers.

## A slot split and its reader agree on parts (split model 2)

`currentSplit` read every division through `bill_split_claims`. Model 2 has
slots immediately and allows one phone to pay several: those two places no
longer described the same bill. It now returns the revision, saved currency,
freeze flag and paid/held parts from slots, without exposing another phone's
checkout. Expiry-on-read remains legacy-only. `split-slots-state.spec.ts`
failed before the change and passes alongside the legacy reader case.

## A payable page owns exactly its reserved parts (split model 2)

The durable diner attempt and the slot owner must agree before Stripe sees a
request. The attempt is saved first, its exact parts reserved second, and its
saved Stripe request sent last. A timeout keeps both the fee and the parts;
a retry repeats the saved request, including its tip. Only a positive provider
expiry or refusal releases its slots. A definite selection refusal retires an
attempt only when it has no immutable slot links. Frozen revision, cents and
fee slices are checked before charging. `split-slots-attempt.spec.ts` failed
before the reservation hook and passes now; `split-slots-pay.spec.ts` checks
staff-opened tables, grouped fees, tips and both currencies.

## A slot charge and its receipt agree on the attempt (split model 2)

The connected webhook sent every split charge to the legacy single-claim
writer. It now sends verified model-2 payments to `settle_split_slots_v1` with
the persisted attempt id and actual charged cents. Only settled, duplicate or
refund-due results acknowledge paid money; failures retry. Positive provider
expiry/refusal releases that attempt's slots. The legacy branch stays intact.
`split-slots-lifecycle.spec.ts` reproduced the missing settlement and release
calls before the fix. `split-slots-money.spec.ts` checks missing receipts,
wrong amounts, fees, allocation scope and a full late-charge refund obligation.

## A whole-table refusal tells staff to collect the parts (split model 2)

SQL refuses ordinary whole-table collection after a divided bill has a paid
or held part. Its TypeScript readers discarded `split`, so Pedidos and Cuentas
abiertas reported a generic failure or the unrelated card-payment message.
Both callers now return the same bilingual instruction with `code: split`.
The older batch reader preserves it too. `split-slots-collection.spec.ts`
failed before the fix. `split-slots-collect-route.spec.ts` checks exact cents,
method, trusted collector, retries and each refusal from the slot writer.

## A slot receipt and its cashier activity agree (split model 2)

The slot writer records the receipt, while the cashier activity feeds the
existing drawer readers. The new route must do both just like partial table
collection: log the actual amount, tip, saved currency, method and remaining
balance, with `collected` or `paid` as appropriate. It logs only new receipts,
so a retry does not count cash twice. The two activity assertions in
`split-slots-collect-route.spec.ts` failed before the log was added; the
repeated-collection assertion keeps the second activity out. Fixture cleanup
removes only activity bearing that fixture's unique table label.

## A slot activity and its receipt agree on old unpaid tips (split model 2)

The activity reads its amount and tip from the receipt, including the unpaid
old gratuities inside the frozen parts. Logging only the new `tip_cents`
would understate collected tips. That extra case also failed before the
receipt-based log and passes in `split-slots-collect-route.spec.ts`.


## Split model-2 screens — 2026-10-28

| Check | Two places that had to agree | Regression coverage |
|---|---|---|
| New splits count people, not phones | The server created immediate parts, but the card capped people by devices and started legacy claims | `split-slots-screen.spec.tsx`, `split-slots-client.spec.tsx`, `split-slots-payment-options.spec.ts` |
| A coupon promise survives the choice to divide | A coupon chosen for whole-bill checkout had not changed the stored bill that a new split freezes | `split-slots-coupon.spec.tsx` |
| A displayed part is the part being paid | The route accepted grouped free parts, but the card described legacy joining and had no honest minimum or held/paid choices | `split-slots-screen.spec.tsx`, `bill-slot-payment.spec.ts` |
| Both staff doors collect parts | The slot writer refused whole-bill collection, but the staff reader and sheets knew only orders | `split-slots-staff-read.spec.ts`, `split-slots-collection-screen.spec.tsx` |
| Bills show what remains, in the right currency and sitting | The ledger covered half the bill while the row/totals showed the full amount and read only legacy claims or the first sitting | `split-slots-bills.spec.ts`, `split-slots-bill-row.spec.tsx`; browser gate fixtures |
| A retry keeps its reference on every supported phone | A lost start reply generated a new reference, and HTTP phones lacked randomUUID | `split-slots-client.spec.tsx`; the collection-screen spec also preserves cash retry bodies |
| A live split stays payable when its surrounding screen changes | A switch or a second currency hid existing parts; an unread split could expose a second whole-bill card offer | `split-slots-bill-sheet.spec.tsx` |
| A refusal speaks to the person collecting or paying | A grouped paid-slot refusal said the cashier's own share was paid | `split-slots-outcome-copy.spec.ts`, `bill-slot-payment.spec.ts` |

### New splits count people, not phones

The start card and the slot protocol had to agree. The old dropdown disappeared
with fewer than two ordering phones and the no-card path only did arithmetic.
New starts offer 2–20 people and create the real parts, with no device ceiling.
A waiter-opened bill can use those same parts while whole-bill card payment
stays with staff. The old phone-claim card keeps its existing flow and comments.
The screen tests failed against the old card before the new path was added.

### A displayed part is the part being paid

The selector and checkout had to agree on free parts and exact cents. Every
part now says free, someone is paying, or paid; only free parts can be chosen.
The phone can pay several together, and an amount below the card minimum asks
for more parts or the waiter instead of inventing money. New tips are separate
and cannot satisfy the food minimum. Tests cover MXN grouping, disabled paid
and held parts, route refusals and the unchanged model-1 payment body.

### Both staff doors collect parts

The staff read and the collection writer had to agree. Neither collection
sheet read slots, so both offered money the route refused. The trusted
outstanding orders now scope the staff slot read; a failed read is loud and
checkout ids stay private. Both sheets share one selector, cash-change helper,
terminal/cash writer and revision-checked cancellation. If a split starts
after the sheet opens, a whole-bill `split` refusal immediately reads and
offers the parts; both entry-point tests failed before that correction. Frozen copy replaces
cancellation after an attempt. The staff screen and mocked database tests
failed before these readers and controls existed, then passed with the fix.

### Bills show what remains, in the right currency and sitting

Payment coverage and the Bills display had to agree. The row and sum still
used the order total after half had been paid, and progress read legacy claims
or the first sitting only. Rows and sums now subtract coverage; model 2 counts
paid slots, with currency and every represented sitting matched explicitly.
The half-paid row and later-sitting/currency tests reproduced both mistakes.

### A retry keeps its reference on every supported phone

A retry and its first request had to agree. The new start initially generated
a different reference after an unanswered request, while a phone on local
HTTP could not call randomUUID at all. The hook now retains the reference for
the same quote and creates a UUID from random bytes when needed. Both tests
failed before the corrections. Cash/terminal retries retain their exact body
and reference too, so a lost reply cannot become another ledger collection.

### A live split stays payable when its surrounding screen changes

The existing division and the bill's visibility rules had to agree. Turning
off new splitting or adding another currency must not hide money already
being collected in parts. Existing parts now stay visible in their saved
currency, and the waiter call survives a pending or failed split read while
the whole-bill card offer waits. The mixed-currency screen test failed before
that correction; switch and loading cases pin the other two paths.

### A refusal speaks to the person collecting or paying

The grouped route and its sentence had to agree. A cashier collecting another
person's parts was told their own share was already paid. Model-2 paid-part
copy now asks them to check the parts in both languages, while model 1 keeps
its original sentence. The bilingual tests failed before that mapping changed.
Taken, reserved, below_minimum, stale, frozen and split retain their translated
route messages, and the clients show those messages without guessing.

The new `SPLIT_SCREENS` inventory reaches the diner and every collector through
both staff doors. Its private fixture cleanup has local mock coverage. Claude
must still run layout at 360/390/820/1280, dialogs, promises and the full shared
gate, and inspect the screens. No worker unit result stands in for that run.


### A coupon promise survives the choice to divide

The coupon shown in checkout and the amount frozen into parts had to agree.
Choosing a coupon changes a whole-bill card payment, not the stored orders.
Starting a split at that point would silently lose the promised discount. The
screen now keeps online coupon payment available and asks the waiter to put
the coupon on the bill before dividing. If another phone divides meanwhile,
it says the coupon is not included instead of pretending it was applied.
`split-slots-coupon.spec.tsx` failed before that screen guard was added.

### A refused split attempt gives everything back together

The held parts and the attempt's fee and coupon had to agree. Separate cleanup
calls freed parts before a failed fee release, leaving an open attempt whose
immutable links prevented every retry. Model-2 refusal and expiry now use
`retire_split_attempt_v1` once, including the connected webhook. An uncertain
reservation still keeps its parts. `split-slots-attempt.spec.ts` and
`split-slots-lifecycle.spec.ts` failed before the change and cover retrying a
failed retirement, refusal, expiry and uncertain provider answers.

### This phone can continue its held parts

The durable attempt and the phone's offered controls had to agree. A reservation
could commit while its answer was lost, before Stripe was called, yet every
held part was disabled even on the phone that owned it. The approved member's
poll now includes only its own open attempts' parts and frozen tip. Continue
payment sends that exact selection through the existing durable scope, without
another fee or a changed tip. Other phones and staff still see held parts.
`split-slots-resume.spec.tsx` transpiles the real payment, attempt, polling and
React modules against an in-memory database. It failed before the fix and now
checks both missing and open provider pages in English and Spanish.

### A receipt can repair its missing activity

The committed receipt and the cashier activity had to agree. A post-commit
balance read could fail before logging; a duplicate then skipped the log forever.
Both outcomes now log from the receipt before reading balances, including the
original cashier, currency, amount, tip and collection time. The payment id is
in the detail and is also the activity row id; insert-on-conflict-do-nothing
makes concurrent retries count once without replacing history. The receipt's
saved reference finds it when SQL returns a duplicate without a payment id.
`split-slots-collect-route.spec.ts` failed before the fix and covers failed
balance reads, missing activity, concurrent retries and activity write failures.
Activity remains best-effort so a log failure never asks staff to collect twice;
a later retry can repair it. Every receipt is described as collected, without
using a later bill balance to rewrite what happened to that receipt.
## The rest of a part-paid bill (paths audit #5, follow-up)

#564 stopped writing off a part-paid bill as a whole, which logged the money
that came in as lost. That left a table that paid MX$80 of MX$100 and walked
out with no way to close. `write_off_remainder_v1` writes off only the rest,
in one transaction under the money lock:
- each part-paid order comes down to what was paid and is paid and completed,
  with an immutable `order_adjustments` row (`forgive`) recording the before,
  the after and what was forgiven;
- unpaid orders on the same table are written off whole.

It refuses while a card page is open, a split is live or a payment is
unattributed. A waiter's ask is stored for the rest and the approval runs the
same transaction. The loss is logged as `written_off` with `kind=rest` and the
amount actually lost, so the corte and analytics count it once. Design and
requirements from Codex's review in the dialogue (topic writeoff). Receipts
showing original / forgiven / paid are still to come, with the receipts pass.
## Paths #3 — a pay-now retry keeps its first payment page

The phone's reference and the pending order had to agree, but only deferred
orders saved that reference. Sending a pay-now request again after a lost reply
created another order and another payable Stripe page. The pending insert now
saves the reference and request scope under the existing unique index. A retry
reads that order before claiming a coupon or stock and returns its open page
from the restaurant's Stripe account. A racing insert gives back only its own
coupon, stock and fee before reading the winner. Each order also gives Stripe
its own stable session key.

`checkout-paynow-retry.spec.ts` runs the route and card-session builder against
an in-memory unique index and mocked Stripe. It checks sequential and racing
retries, changed details, an opening or completed page, tenant boundaries,
read failures, unchanged no-reference behavior and byte-identical deferred
scopes. An expired page is refused while its order exists. Once the existing
abandon handler deletes that order, the reference can create one new order;
renewing the same order is a later improvement. Claude's live gates still need
to verify the actual unique-index race and expiry webhook cleanup.

The menu never sent a reference for a card payment, so the server half alone
changed nothing for a diner. `useCheckout` now gives each card payment one,
kept across sends that had no answer and let go on the same rule as a pay-later
intent (`refusalSettles`). Unlike pay-later, the body is built afresh each time:
a cart trimmed after a sold-out refusal must not be charged as it was, and a
cart changed after a lost reply is told so (409). Claude finished this after
Codex hit its usage limit.

## A receipt that added pesos and dollars (paths audit #8)

A receipt covers every order a table settled at once, and the builder takes the
first order's currency for the whole sum. The print path (#562) already refused
a mixed set; email did not, so MX$100 and US$10 from the same restaurant went
out as MX$110. Both deliveries now refuse it, and a failed order read answers
503 instead of "not found".


## Forgiven bills and payment receipts — 2026-10-28

| Rule | Two places that had to agree | Regression coverage |
|---|---|---|
| A forgiven receipt explains the original bill and what was paid | The order total came down while email and paper kept the original dishes without the loss | `receipt-forgiveness-route.spec.ts`, `receipt-forgiveness.spec.ts` |
| Reprinting keeps the financial version that was issued | A later forgiveness silently changed the receipt read from live orders | `receipt-forgiveness-route.spec.ts`, `receipt-version-prompt.spec.tsx` |
| A slot receipt confirms its payment | One person's parts and tip could be replaced by the whole table's bill | `receipt-forgiveness-route.spec.ts`, `receipt-version-prompt.spec.tsx` |
| The money check reconciles forgiveness and its single loss event | Coverage at a reduced total passed without checking the adjustment or the operation's whole-order losses | `forgiveness-money.spec.ts`, existing `allocation-money.spec.ts` |

### A forgiven receipt explains the original bill

The saved adjustment and the shared email/paper renderer had to agree. The
receipt API now reads the typed forgiveness, including the original and
resulting total, tip and service charge. Original dishes and discounts keep
their original service and tip; original bill less the restaurant's forgiveness
equals paid. English and Spanish use the same rows and arithmetic. A failed or
inconsistent adjustment read issues no unexplained receipt. The print and email
route cases failed before the fix; bilingual renderer cases check both forms.

### A copy keeps the financial version that was issued

The original copy and the reissue request had to agree. Order receipts now
return `version.adjustmentIds`: the included immutable forgiveness IDs, or an
empty list for the original bill. A reissue sends that version and reconstructs
the original total, tip and service charge from the adjustment when needed.
Unknown or duplicate version IDs are refused. The receipt prompt shares the
issued version between email and print, and a different bill starts fresh.
A version selects saved facts; the caller never supplies money. This preserves
the financial copy without expiring it or blocking a sale. Legacy callers with
no saved version ask for today's statement; an explicit empty version asks for
the original. Full historical HTML, restaurant-name and locale snapshots are
not added by this change.

### A slot receipt confirms its payment

Paid parts and receipt amounts had to agree. The receipt API accepts the
immutable payment ID and checks its slot, sitting, restaurant and currency
links. It lists the numbered parts together at their principal, the ledger's
full tip and the actual charge, dated when that payment arrived. Old gratuities
inside the frozen parts are included in that tip, once. Other unpaid parts,
later dishes, menu currency changes and later forgiveness cannot replace that
payment with the table's bill. Payment receipts do not mark an entire order as
emailed. The payment cases failed before the fix and pass while orders remain
unpaid. `ReceiptPrompt` and `ReceiptPrint` accept a payment identity; the
follow-up below wires the diner offer and separate staff reprint route.

### The money check follows the forgiveness operation

The reduced paid total, its adjustment and its loss log had to agree. The
allocation checker now distinguishes `cancel` from `forgive`, checks the rounded
original-minus-resulting loss, paid state and exact retained total/tip coverage,
and requires one `bill/written_off` event with `kind=rest` at the operation ID.
Its amount is the sum of that operation's forgiven amounts and wholly written-off
orders. Whole orders currently carry no operation ID: the writer's identical
transaction timestamp, actor, restaurant and currency connect them to the log.
The checker preserves sub-millisecond timestamp precision and fails ambiguous
matches rather than counting a whole loss twice. A durable whole-order link
would require a later SQL change. Whole-only operations are checked too.
The malformed adjustment, unpaid/uncovered order, missing/duplicate/foreign/wrong
loss-event and wrong whole-loss cases failed before this check. No live database
or money gate was run by this worker; Claude owns those checks.

The new forgiveness readers count decimal half-cents as PostgreSQL does: `1.005`
becomes 101 cents, and `2.675` becomes 268. The two half-cent route/checker cases
failed before this correction. Table originals round per order before adding,
so original minus forgiveness equals paid even with several unscaled totals.
Existing collection and write-off writers are outside this receipt/checker fix.

## Slot receipt offers and staff reprints — 2026-10-28

| Rule | Two places that had to agree | Regression coverage |
|---|---|---|
| A paid part offers its own receipt once | Checkout and staff collection created payment receipts, but the phone watched only whole-order settlement | `slot-receipt-offer.spec.tsx`, `slot-receipt-payments-route.spec.ts` |
| Staff paper includes the restaurant's forgiveness | The diner reader explained the loss, but staff reprints read the reduced order alone | `staff-receipt-reprint.spec.ts`, existing `kitchen-print.spec.ts` |
| Staff can reprint a paid group of parts | The receipt renderer accepted payments, but the staff route required an order | `staff-receipt-reprint.spec.ts` |
| A query names a column its table has | The slot-receipt readers filtered `bill_splits` by `table_id`, which it never had; mocked tests passed and every approved phone's receipt list answered 503 | `invariants/database.spec.ts` ("a query names only columns its table has"), `pnpm api` |
| One provider refund pays one obligation | A manual refund attributed to a return was also counted by the duplicate-charge coverage writer; both closed with half the money back | `returns-schema.spec.ts` (audit 1), `loop/returns-probe.cjs` |
| No manual attribution while an app refund is in flight | A manual MX$40 attributed mid-POST let the app's saved MX$100 still leave: MX$140 for a MX$100 promise | `returns-schema.spec.ts` (audit 2), `loop/returns-probe.cjs` |
| A return's header names the refund that finished it | A failed first refund stayed on the header and manual completion left it empty, so fee reconciliation and completion evidence missed real refunds | `returns-schema.spec.ts` (audit 4), `loop/returns-probe.cjs` |
| An offline replay acknowledges what was collected | A return made before the tablet reconnected lowered the total its replay reported, so the device never released the sale | `returns-schema.spec.ts` (audit 6) |
| An unknown tip breakdown goes to review | A historical receipt without its tip let returns plan principal it did not hold, leaving money nobody could return | `returns-schema.spec.ts` (audit 8) |
| One bad saved payment cannot blank a diner's split | A held card attempt whose saved scope did not match made the whole split read throw: 500, no parts, nothing to press | `split-slots-resume` (skip and log), `pnpm layout` "diner paid, held and chosen parts" |
| A promise is judged on the loaded screen | The bill shows "pay at the table" while it still checks for a split; the audit judged it then and reported three bills as explaining nothing | `promise-audit.mjs` waits for the expected words, bounded at 30s |

### A paid part offers its own receipt once

The selected parts and the receipt offer had to agree. Card checkout remembers
its sitting, split and selected parts only after receiving a redirect. On the
return, the phone waits for their immutable payment, including a late webhook.
A small sitting reader checks approved membership, including a closed sitting,
and exposes only grouped payment IDs and part numbers, never checkout secrets.
Another table, restaurant or party cannot supply the observed payments.

The phone polls even while its bill sheet is closed. A first successful read
sets the baseline; later staff collections offer a payment receipt even while
the table owes more. Repeated polls and refreshes do not repeat an offer.
Concurrent collections queue without replacing an open receipt, and unshown
receipts survive refresh. Failed reads never invent a payment or erase the
baseline. The final parts do not also offer the whole table's order receipt.
The bill sheet and tracker wait behind the receipt question, so their focus
traps cannot compete. Receipt memory failures never prevent a card redirect.
The original whole-order card and cash offers remain covered too.

The hook cases failed before wiring; English and Spanish use the existing
receipt prompt. The route cases check membership before reads, tenant/sitting
filters, closed-sitting access, polling limits and read failures. These are
mocked local checks; Claude owns the browser and database gates.

### Staff paper includes the restaurant's forgiveness

The saved forgiveness and staff reprint had to agree. The staff route now uses
the same adjustment-aware source as diner email and print. It shows original,
forgiven and paid amounts in both languages, returning the receipt version.
Passing an issued original version keeps that copy's original amounts after a
later forgiveness. An unread adjustment issues no plausible but incomplete
paper. These route cases failed before the change. Existing kitchen grants,
tenant scoping and deliberate requeue behavior remain covered.

### Staff can reprint a paid group of parts

The immutable payment and staff paper had to agree. A staff receipt accepts
exactly one order or payment identity, reads a payment only in that staff
restaurant, and prints its numbered parts, full tip and actual charge before
the remaining parts are paid. It never substitutes the table's dishes or
current currency. Both language cases failed when the route required an order.
Kitchen and unauthenticated callers are refused before financial reads, and a
payment cannot be sent to the kitchen printer.


## Completed returns preserve the sale (Returns 7b)

The order and the return plan have to agree without cancelling a meal already
served. `returns-components.spec.ts` exercises mixed principal/tip receipts,
forgiveness followed by a full return, service exhaustion and duplicate-payment
refusal through the preparation RPC. The route never rewrites orders, coupons or
stock itself. These mocked answers do not prove the database's component rules;
Claude owns the SQL and transaction gates.

## One request per return reference (Returns 7b)

The reviewed snapshot and its retry have to agree even when the first answer
was lost. `returns-references.spec.ts` checks identical and conflicting refs,
stale distinct refs and replay after zero. `order-return.spec.tsx` checks the
reason requirement and an unchanged body/reference after a lost reply. Closing
the dialog does not discard its request; an explicit discard remains available.

## Actual card coverage before another POST (Returns 7b)

The provider's refunds and the saved promise have to agree. Discovery runs
before `start_refund_attempt`, pages every refund and records verified saved
manual attribution first. `returns-provider.spec.ts` checks manual 40 plus app
60, unassigned manual review, sequential operation keys, foreign currency and
legacy exact cancellation recovery. `returns-boundary.spec.ts` verifies that a
manager cannot substitute client-reported provider amounts or another charge.
An operation-only partial tag is never proof the whole promise was returned.

## Expired unknown provider keys (Returns 7b)

The saved attempt and Stripe's finite key lifetime have to agree. After 23 hours,
an unknown attempt without durable provider evidence stays pending for review;
it cannot POST again on the assumption that no refund was found. The expired-key
case in `returns-provider.spec.ts` fails if a second POST becomes possible.
This never holds up selling, collecting, navigation or signing out.

## Original sales and dated returns (Returns 7b)

The reduced live bill and historical sales readers have to agree about which
day earned the sale. `returns-reporting.spec.ts` and `returns-readers.spec.ts`
restore immutable components for analytics/products/average tickets, preserve
forgiveness, and date each completed operation separately across local midnight.
An exact upper-bound timestamp belongs only to the next day. Pending and failed
operations do not leave a drawer; imported log deductions remain deduplicated.
A reduction racing a read asks for retry instead of inventing a new sale total.

## Return amounts on every receipt (Returns 7b)

The reserved plan and the receipt have to agree without calling an unfinished
cash part returned. `returns-reporting.spec.ts` and
`returns-receipt-source.spec.ts` cover original/completed/pending/retained totals,
methods, manual partial coverage and slot-payment allocations. The same renderer
feeds plain text, email and print. A failed financial read cannot issue a
plausible-looking receipt with missing return money.

## Issued copies stay issued (Returns 7b)

The first receipt and its reprint have to agree even after another return or a
provider failure. A signed financial version preserves the issued amounts and
outcomes; the reader verifies restaurant, receipt identity and currency.
`returns-receipt-source.spec.ts` rejects tampering and cross-tenant reuse.
`return-reprint.spec.tsx` reproduces the staff dialog dropping its version and
checks that it resends the issued copy, resetting it only for a different order.

## Completed-sale return action (Returns 7b)

The role that can see a return and the role that can authorize it have to agree.
Only owners/managers get completed history and returns on Pedidos; cashiers,
waiters and kitchen cannot prepare, attribute or finish through the API.
`order-return.spec.tsx`, `returns-boundary.spec.ts` and the updated access
invariant cover the screen and server boundary. The API cases prepare/replay a
private completed cash/terminal sale and confirm its payout twice. The layout
list names both return dialogs; Claude runs it and inspects 390/1280 screenshots.
### A query names a column its table has

The code and the schema had to agree on a column. The slot-receipt list and
the slot-receipt reader both asked `bill_splits` for `table_id`; a split
belongs to its sitting and has no table of its own. Every unit test mocked the
database, so all of them passed, and the first real request answered 503 for
every approved phone. `pnpm api` found it. A new invariant reads every plain
`select` and filter on a known table against `schema.sql` (3,160 references
today) and failed on both lines with the fix reverted. The table now comes from
the sitting, which the membership check already ties to the table.

## Returns audit #575 — legacy attempt currency

| Rule | Two places that had to agree | Regression coverage |
|---|---|---|
| A saved return survives the currency column deploy | Old attempts had no currency while their operations retained the charge currency | `returns-provider.spec.ts`: pre-deploy null-currency attempt |

The attempt and its operation had to agree about the original charge. A null
attempt currency now falls back only to its operation, never today's restaurant
currency. Provider IDs and exact legacy tags still recover the saved outcome
without another POST. No backfill is needed; a conflicting saved currency is
still refused.

## Returns audit #575 — forgiveness followed by returns

| Rule | Two places that had to agree | Regression coverage |
|---|---|---|
| A forgiven bill can later return money | The forgiveness snapshot stayed fixed while the order and retained allocations came down | `forgiveness-money.spec.ts`: forgiveness followed by returns |

The saved forgiveness and today's retained coverage had to agree after returns.
The checker now subtracts that order's immutable return deltas from the
forgiveness result, including tips. It still verifies the original loss and its
single event unchanged. Partial and full returns no longer report a false
coverage failure.

## Returns audit #575 — replay the collected sale

| Rule | Two places that had to agree | Regression coverage |
|---|---|---|
| A replay after a return leaves the device | The replay used the retained bill while the device remembered the original collection | `pos-return-replay.spec.ts` |

The server's repeated ticket and the device's saved charge had to agree. After
checking tenant, method, currency, paid state and account request scope, the
TypeScript reader now uses `pos_ticket`, the same ticket reader as the atomic
writers. It must return the original collection after partial or full returns.
The device still refuses contradictory amounts; it never silently drops money.
The SQL correction to `pos_ticket(uuid, uuid)` is owned by Claude and must ship
with this reader. Mocked replay tests are not database proof.

## Returns audit #575 — the tracker shows paid and returned money

| Rule | Two places that had to agree | Regression coverage |
|---|---|---|
| Total paid stays the amount the diner paid | Return preparation lowered the order while the tracker kept its paid label | `tracker-return-source.spec.ts`, `tracker-returns.spec.tsx` |

The tracker and receipt had to agree about money already returned and still to
return. The tracker now reads the receipt's verified coverage, restores the
original paid amount and shows separate returned and pending amounts. English
and Spanish are covered through `TrackerBody`, including a manual partial
return. A failed financial read asks for retry instead of inventing amounts.

## Returns audit #575 — each successful refund has its own date

| Rule | Two places that had to agree | Regression coverage |
|---|---|---|
| Reports date money when each refund succeeds | The receipt counted a successful manual partial while analytics and corte waited for final operation completion | `return-event-dates.spec.ts`, updated `returns-readers.spec.ts`, `returns-reporting.spec.ts`, `shift-return-trail.spec.ts` |

The receipt's verified coverage and dated reports had to agree. Analytics,
corte, collected-today adjustments and the shift trail now read individual
successful amounts from `order_return_events_v1`, including manual partials.
Completing the remainder tomorrow cannot move today's returned money into
tomorrow. Dated reports use an exclusive end; the shift trail keeps its existing
inclusive closing instant. Imported log deductions stay excluded from typed
corte/trail deductions, and cancellation money stays outside completed-sale
return analytics. A failed event read cannot become a zero-refund day.

The new SQL read and durable per-refund success timestamps are prerequisites,
not implemented or applied by this TypeScript worker. The exact contract and
legacy evidence rules are in `docs/returns-audit-ts-handoff.md`.
### Returns: one refund, one obligation (returns audit 1, 2, 4, 6, 8)

Codex audited #575 read-only and every one of these was two places that had to
agree. The duplicate-charge writer and the return writer each counted manual
refunds on the same charge, so one refund could close two debts; it now skips a
refund a return owns, as the return writer already skipped a due's. A manual
refund attributed while an app refund was in flight let both leave; attribution
now waits for the app's outcome. The return header kept a failed first refund
and was left empty by manual completion, so fee reconciliation never matched;
completion stamps the latest refund that still counts and the reconciler matches
any of an operation's succeeded refunds. An offline replay after a return now
acknowledges the collected amount. A receipt that never recorded its tip goes to
a person before any plan is made.

### Returns V6 — a manual refund keeps its provider date

Stripe's successful manual refund and the report's day had to agree. Manual
attribution now sends `refund.created` as epoch seconds in `succeeded_at` only
when Stripe reports success. Pending manual evidence carries no date. App
attempts still send no date, including recovery after a pending response, so
SQL uses the verification time. `return-success-time.spec.ts` checks the RPC
payloads; SQL keeps the first saved date and caps future evidence at now.

### Returns verification 3 — manual-only completion needs no app attempt

The saved operation and the executor's reply had to agree. A manager could
finish the whole return with manual refunds after discovery, before start took
its lock. Start correctly made no app attempt, but the executor checked that
missing attempt's account before recognizing completion. It answered incomplete
and missed immediate fee recovery. Completion now comes first, using the
operation's saved charge and account for fee recovery. A failed fee lookup
still leaves the customer's return complete. `return-manual-completion.spec.ts`
first failed four cases, then passed all nine: concurrent success, zero owed,
null app fields, already completed money, failed fee recovery and unproven
replies. No provider refund is sent for completed money.
### One bad saved payment cannot blank a diner's split

The split read and each saved card attempt had to agree on the attempt's
scope. When one did not, the resume check threw, `/api/split` answered 500,
and the phone showed "No pudimos leer las partes" with no part to choose and
no button to press. Only the gates' fixture made such an attempt (a made-up
scope key), so it failed every layout and dialog run of the diner's divided
bill; a real phone would have hit it on any attempt saved under an older
format. A mismatched attempt is now simply not offered for resuming and is
logged; its parts stay held, so nothing can be paid twice. The fixture now
writes the card path's own key, and the seed picks a bill large enough for
three card parts, so its card hold is never refused at random.

### A deal only ever lowers the bill

The saved deal and today's product price had to agree. Tiered deals were
priced largest bracket first, and a bracket was applied even when it cost more
than its units: "2 for MX$180" saved when the dish cost MX$100 charged MX$180
for two once the dish dropped to MX$80, and four MX$10 items under "2 for 15"
and "3 for 25" cost 35 instead of two pairs at 30 (Codex sweep 1). The tier
maths now finds the cheapest combination with single units always allowed at
their normal price, so no basket is ever dearer than its units, and pricing
clamps a deal's saving at zero. `promo-math.spec.ts`.

## An admission read that stopped the clock (Sweep 1 #4)

The next poll and the previous read had to agree about when a read ends. A
connection that never answered kept `running` true forever. Both membership
pollers now abort a read after twenty seconds, including its response body,
and cancel it on teardown. The serialized diner reader also releases its
queue, and waiting for another tab’s Web Lock has the same deadline. Other interval hooks have no matching running latch.
`membership-timeout.spec.tsx` stalls each reader, checks cancellation and the
next poll, and checks teardown; the existing membership tests retain slow-read
serialization and last-good data coverage.


## Nobody waiting, or a read that failed (Sweep 1 #5)

The server read and the board's empty message had to agree about whether
there was an answer. Supabase returned an error, but Pedidos discarded it and
painted empty lists. Both kitchen and floor feeds now carry their failure to
the board, which offers Retry in both languages and never claims there are no
live orders while either feed has failed. Available tickets remain usable; a
failed calls refresh keeps the last good list. `kitchen-orders-page.spec.tsx`
refuses each initial feed; `inactive-orders.react-component.spec.tsx` checks the
error, retry click and successful recovery.


## The raised hand nobody could see (Sweep 1 #6)

The duplicate check and the board had to agree about which open calls still
count. Pedidos loaded eight hours, but the route matched all time, so an old
call hidden from staff made a new tap say success without calling anybody.
Both now use `serviceRequestCutoff`; the live calls list also ages out every
thirty seconds, including late realtime inserts. The existing eight-hour
window stays the same and never prevents a fresh call.
`service-request-expiry.spec.ts` checks one millisecond before, at and after
the cutoff; `service-request-expiry.spec.tsx` keeps a board open across it.


## Listo before the food was ready (Sweep 1 #7)

The stage badge and the footer had to agree about the food. A waiter cannot
start preparation, so the missing button fell through to a green “Listo”.
That fallback now uses the same stage label and colour as the badge. Existing
English and Spanish stage names cover it; ready tickets still offer delivery
and kitchen tickets still offer preparation. `order-card-stage.spec.tsx`
renders both languages and checks those permissions as well as the footer.


## One withdrawal, three lines in the drawer (Sweep 1 #8)

The saved operation and its activity had to agree about what a retry means.
Withdrawal, shift-close, waste and count RPCs replay their saved result, but
the routes appended another log every time. Their activity now has a stable
UUID derived from restaurant, entity, action and operation identity, inserted
with `onConflict: "id", ignoreDuplicates: true`. Concurrent retries cannot
append or replace the first line. A failed log stays best-effort, so money
operations still succeed and a retry can repair the missing line. No schema
change is needed; previously duplicated rows are not rewritten.

`financial-activity-retry.spec.ts` exercises each route through the real
logger with a mocked database, including concurrent retries, a failed log,
another actor's replay, distinct operations and restaurant separation. The
purchase retry already logs in its SQL transaction; account collections and
POS/table orders skip duplicate results, split-slot receipts already use their
receipt id, and terminal deposits refuse an already marked day before logging.
Those do not append activity on a successful replay.
### A receipt is recorded when it was written, not when its transaction began

The cash close and its receipts had to agree on which side of the cutoff each
receipt fell. The close stamps its cutoff with `clock_timestamp()` after taking
the money lock, but payments defaulted `recorded_at` to `now()`, the
transaction's start. A POS sale that began before a close and waited for the
lock committed afterwards with a recorded time before the cutoff, so the
close's reconstruction included a receipt the close never counted and
reported its expected cash as inconsistent (Codex sweep 1). `recorded_at`
now defaults to `clock_timestamp()`. `close-receipt-time.spec.ts`.
### The payment ledger is management's to read

The table's policy and the app's own role checks had to agree. Every money
screen reads payments on the server with the secret key, behind a role check
(the takings route refuses a cashier), yet the policy let any waiter or
cashier select the whole ledger directly: every collector's receipts, amounts
and tips (Codex sweep 2). Only managers and owners read it now; `pnpm rls`
asserts a cashier cannot, where it used to assert the opposite.

## Extras belong to a plate, not just to a restaurant (Sweep 2 finding 2)

The extras a dish offers and the extras the server accepted had to agree.
Checkout and POS fetched prices but never checked the product's saved links,
the extra flag, its menu, or required choices. A closed-lunch steak could ride
along with dinner as an extra without anyone choosing how to cook it.

`verifiedLines` now reads the saved links with each restaurant-scoped item.
`verifyExtras` checks those links, the extra flag, availability, its own open
menu and required choices for plain dishes and every combo plate. Extras carry
no choices, so one that now needs an answer follows the existing extras-changed
confirmation: remove that extra and let the rest of the cart be ordered.
Legacy combo extras saved only on the parent go to a plate that offers them.
Waiter orders use the same verification; offline price comparison reads the
same fields while preserving its existing closed/sold-out waiver and manager
approval path for changed sales.

`sale-menu-verification.spec.ts` first reproduced the closed-lunch steak and
checks each rule on plain lines, combo parents and combo components.
`cart-integrity.spec.ts` keeps combo price, stock and ticket copies in agreement.

## A section does not open an item's menu (Sweep 2 finding 3)

The item's own menu and the availability check had to agree. The check instead
followed its category, treating a missing category as always open. A closed-menu
item could be sold uncategorized or under another menu's section.

`orderableNow` now checks menu ids directly. `verifyCart` passes each product's
and combo component's saved `menu_id`, as `verifyExtras` does for extras.
An item without an open menu cannot be sold. `sale-menu-verification.spec.ts`
checks closed-menu items with no category and with an open menu's category,
open uncategorized items, and closed combo components.

## Deleting an icon group is desk work too (Sweep 2 finding 4)

The subscription freeze and every icon-group write had to agree. POST and
PATCH checked the freeze but DELETE forgot it. `freeze.spec.ts` first reproduced
a successful deletion on a frozen restaurant.

All three handlers now run through `deskMutation`, which resolves a manager
and checks the freeze before reading a body or reaching the database. Use that
shared wrapper for new unconditional manager desk writes. Payments, sign-out
and floor work keep their existing guards. The spec checks every verb refuses
before database access, and that an open desk can still delete only its own
group without claiming another restaurant's group was deleted.
