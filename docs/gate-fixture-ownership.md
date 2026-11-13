# Gate fixture ownership

Read-only means the request leaves its fixture rows unchanged. It can still
write a rate-limit counter or read the restaurant's existing books. Shared
rows are created lazily, owned by one run and deleted in its final cleanup.
The existing effect and refusal assertions are unchanged.

## Shared by the API gate

| Set | Cases |
|---|---|
| Unstarted split, MXN 11000 cents | `/api/split/start`: stale amount and wrong currency |
| Started split, two parts, MXN 11000 cents | `/api/split/start`: busy and same-request replay; `/api/split/resize` and `/api/split/cancel`: stale revision and missing split; `/api/split/collect`: stale revision and wrong currency; `/api/split/pay`: stale revision |
| Written-off order and its private ticket | `/api/orders` and `/api/orders/station`: owner and kitchen refusals |
| Active frozen coupon or promotion | Refused edit hidden behind an off flag, and refused deletion |
| Inactive frozen coupon or promotion | Refused resumption; distinct from the active set |

## Shared by the attack gate

One unchanged two-part split serves both the stale-revision/cross-restaurant
case and the kitchen-role case. Their existing slot and receipt comparisons
still run after every request.

## Cases that still own private rows

- Split start with four parts; start with no debt; successful resize/cancel.
- Frozen split resize/cancel, reserved collection and taken card part: their
  setup creates a reservation and checkout attempt.
- Split collections: cash, card, duplicate, already paid and both last-part
  email choices. Their setup or request writes money or completes an order.
- Split pay: taken, already paid and below the card minimum. These need their
  own reservation, collection or amount; the successful percentage-tip probe
  also creates durable checkout state.
- Both attack collection currencies, overlapping reservations and the
  card-held-part case.
- Switching a frozen offer off succeeds, so its offer is private.
- Completed returns, retry/idempotency cases, admission scenarios, stock
  races, old-versus-new sittings, legacy split changes and account-journal
  scenarios keep their existing private fixtures or intentional case chains.
- Ordinary API and attack data already shared by setup remain run-owned.

For these groups, API split-slot setups fall from 28 to 19 (including the
percentage-tip probe); inactive-order setups fall from four to one; frozen
offers from eight to six; attack split-slot setups from six to five. These
are source-level counts, not measured database I/O. No gate was run here.

## Claude's validation

Apply the two updated trigger functions in `supabase/schema.sql`, then run a
rolled-back probe comparing seeded explicit receipts with legacy backfill,
including tipped and cancelled orders. No signatures or objects were added.
After seeding, inspect allocation version, preserved tips and historical
review rows. The complete seed can still request a no-op historical import
under #638 while those review examples remain.

The seed reaches every screen: run all gates without page or API scoping
under `loop/gate-policy.md` section 3. Leave `GATE_PAGES` and `GATE_API` unset.
Include whole `api` and `attack` runs for the fixture changes and verify
cleanup after a refused request and an interrupted run. Smoke runs once for
the dev-server session. No UI copy or layout changed.
