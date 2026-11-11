# Account journal fixture inventory (PR 2, part 2)

This audit covers `scripts/api-cases/*`, `attack*.mjs`, `promise-*.mjs`,
`layout-fixtures.mjs`, `browser-fixtures.mjs`, `probe-*.mjs`, `mock-*.mjs`,
`db.mjs`, and their fixture helpers. No database or network gate was run.
The deferred check and source immutability guards are unchanged.

## Account source writes

| File | Before | After |
| --- | --- | --- |
| `scripts/api-fixtures.mjs` | Accounts, table charges and POS account sales shared Demo Bistro; teardown deleted account receipts, charged orders, checkout rows and accounts individually. | Account cases use `api-account-fixtures.mjs`, with a started disposable restaurant and private owner/manager/waiter/cashier/kitchen logins. Teardown deletes that restaurant, then its logins. Ordinary receipt cleanup explicitly excludes account receipts. |
| `scripts/api-cases/accounts.mjs` | Account requests and attribution assertions used demo identities. | Same charge, ceiling, credit, collection, tip, statement and role assertions use private fixture identities. Cases carry their fixture context. Charges and collections still use the routes. |
| `scripts/api-cases/refunds.mjs` | Attached `acctOrder2` by updating `orders.account_id`, manually inserted the open checkout/hold, then detached the order. | Charges through `account_charge_v2`, opens through `account_checkout_currency_v1`, releases through `account_checkout_release`; leaves the charged order retained until restaurant cascade. The cancellation must still be refused without cancelling the order. |
| `scripts/attack-accounts.mjs` | Three direct `account_id`/`charged_by` updates prepared collection attacks; two inserts attached checkout-attack orders directly. Cleanup deleted account receipts and charged orders individually. | All five arrangements charge through `account_charge_v2`; the role, tenant, ceiling, replay, tip and open-checkout assertions remain. Two started disposable restaurants own all rows and leave through restaurant cascades. |
| `scripts/attack-account-credit.mjs` | Inserted both tenants' orders with `account_id`. | Inserts ordinary orders, then charges both through the shared writer helper. Role/tenant refusals and one-credit/no-receipt replay assertions remain. Caller deletes both restaurants. |
| `scripts/probe-account-credit.mjs` | Inserted account/charge-date fields directly; changed a retained legacy order's currency to USD. | Starts isolated restaurants, inserts ordinary orders and charges through `account_charge_v2`. Establishes the USD ceiling/order currency before charging, then clears only the legacy ceiling metadata to retain the existing currency-freeze assertion. Restaurant cascade cleanup remains. |
| `scripts/allocations-check.mjs` | Generic order insert could attach an account directly; the account-tip case used it. This helper runs before the API cases. | Generic order insert has no account column; account-tip arrangement calls `account_charge_v2` before the existing settle RPC. Its intentionally refused ordinary receipt update explicitly excludes account receipts. Transaction rollback cleanup remains. |
| `scripts/account-journal-probe-fixtures.mjs` | Every account order was inserted with account/charge-date columns. | Ordinary orders use `account_charge_v2`; collections and credits continue through their RPCs. Only two historical imports remain direct, in the private `dormantOrder` helper described below. |

No direct `order_adjustments` insertion/update/deletion for account orders was
found in the requested scripts. Existing credit/cancellation writers own those
rows. No matching write was found in the promise scripts or the layout/browser
fixture files. `probe-account-journal.mjs` retains its backfill assertions and
its final restaurant cascade.

## Other receipt writes and cleanup bounds

These are ordinary sale/table fixtures, not account-money arrangements. Every
changed cleanup now adds `.is("account_id", null)`; their existing assertions
remain unchanged:

- `scripts/api-cases/payments.mjs`: remove the table-payment case's receipt.
- `scripts/api-cases/pos.mjs`: remove the register-only sale receipts.
- `scripts/api-part-collection.mjs`: clean the two-sitting collection receipts.
- `scripts/api-retry-fixture.mjs`: clean retry-case receipts.
- `scripts/api-terminal-deposit.mjs`: clean the terminal snapshot race receipts.
- `scripts/attack-money.mjs`: all eight sweep/per-case receipt deletions.
- `scripts/returns-fixture.mjs`: clean the private ordinary sale receipt.
- `scripts/rls-check.mjs`: clean the cross-tenant collection control receipts.
- `scripts/rls-fixture.mjs`: separate receipt cleanup from the dynamic table
  loop and bound both order-linked and orphan receipt cleanup.
- `scripts/split-slots-fixture.mjs`: clean split-sitting receipts.
- `scripts/table-join-scenario.mjs`: clean admitted-phone order receipts.

`mock-data.mjs` had two receipt selectors over paid orders without an explicit
account exclusion; both now require `orders.account_id is null`. Its explicit
offline-sale receipt insertion belongs to newly created ordinary sales.
`mock-terminal.mjs` could update terminal metadata on any card receipt; it now
excludes both account receipts and receipts linked to charged orders.

## Seed and harness

Part 1 already changed `mock-accounts.mjs` to charge through `account_charge_v2`
and `db.mjs` to run `journal-activate.sql` transactionally after the development
mock seed. Those operations remain. The new invariant checks that wiring;
`mock-accounts.mjs` now documents how `account_movements` are populated. Both
the owing Carmen account and empty Luis account become started on a fresh dev
mock seed. Fresh-database reconciliation has not been executed in this run.

New helpers `disposable-account-fixtures.mjs` and `api-account-fixtures.mjs`
create isolated restaurants, private logins and ordinary orders, check charge
RPC outcomes, and clean through restaurant cascades. `api-check.mjs` uses each
case's fixture consistently for arrangement, request, role cookies and effects.

## Invariant and bounded historical exception

`src/lib/__tests__/invariants/account-fixture-writes.spec.ts` scans every script
`.mjs`, using the TypeScript AST helper `account-fixture-writes.ts`. It rejects
direct order attachment/charge-date/actor payloads, explicit account receipts,
account-source deletion, direct adjustments, unbounded receipt mutations,
bulk account columns and corresponding SQL. Thirteen planted bad-line strings
prove detection, including aliases, spreads, SQL and missing cleanup bounds.
Reads, real RPC calls and explicitly ordinary receipt cleanup stay allowed.
It also checks the development seed activation wiring.

The only reviewed exception is the **private, non-exported `dormantOrder`** in
`account-journal-probe-fixtures.mjs`, called exactly twice: unknown-date MXN
history and mixed-currency USD history. Current charge writers intentionally
cannot manufacture either historical state. Converting those two imports would
change what the backfill probe proves. The helper asserts that the account and
restaurant are dormant, and the INSERT itself requires both start markers to
be null and must insert exactly one row. The invariant allows only this named
function in this exact file and checks its guards and two call sites. No live
fixture may call it. This is an explicit exception to an absolute ban on direct
historical imports, not an exception to any database guard.
