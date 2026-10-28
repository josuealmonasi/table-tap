# Returns audit #575 — TypeScript integration

Worktree: `tt-wt-ret-audit-ts`; branch: `codex/returns-audit-ts`.
No SQL was edited or run. No live database, server or gate was started.

## SQL dependencies for Claude

### Finding 6: original POS ticket

Keep `pos_ticket(p_restaurant uuid, p_ref uuid)` and its existing JSON contract.
For a repeated settled sale, `total` must be the amount originally collected,
including money now reserved or successfully returned. It must not be today's
retained `orders.total`. Keep currency, method, identity, on-account fields,
paid/pending refusal, tenant checks and advisory lock unchanged. TypeScript
checks the existing order's method, currency, paid state and account scope,
then reads this RPC, just as the atomic sale writers do. There is no signature
change. The device still compares the answer with its original saved charge.

### Finding 7: successful return events

Add a service-role-only, stable, set-returning read:

`public.order_return_events_v1(p_restaurant uuid, p_currency text default null)`

Return these typed columns (no JSON envelope):

| Column | PostgreSQL type | Meaning |
|---|---|---|
| `id` | `text` | Stable unique event identity, for deterministic pagination |
| `operation_id` | `uuid` | Owning refund operation |
| `order_id` | `uuid` | Order from that operation's adjustment |
| `kind` | `text` | Adjustment kind: `return` or `cancel` |
| `source` | `text` | `stripe`, `cash`, or `terminal` |
| `currency` | `text` | Operation currency, never today's restaurant currency |
| `amount_cents` | `integer` | This event's positive successful money, including tip |
| `succeeded_at` | `timestamptz` | Durable success time for this piece of money |
| `payout_actor` | `text` nullable | Same drawer attribution as the operation |
| `confirmed_by` | `text` nullable | Operation's confirmer |
| `historical_log_id` | `uuid` nullable | Existing log identity for deduplication |

Rules the mocked contract requires:

- Filter the tenant in SQL, joining attempts, operations and adjustments by
  tenant as well as identity. Filter operation currency when `p_currency` is
  non-null. Do not expose this read to public, anon or authenticated.
- For Stripe, return one event per distinct successful `stripe_refund_id`
  attributed to the operation, app or manual, even while the operation remains
  processing. Exclude failed/canceled/pending evidence and `refund_failures`.
  Duplicate evidence for one provider refund counts once. Never also emit the
  operation's full amount for those same pieces. Sum must match the verified
  successful coverage used by `refund_operation_progress_v1` and receipts.
- Each event needs a success timestamp that retries cannot move. Today's schema
  has only mutable attempt `updated_at` and the operation's final `completed_at`;
  neither can reliably date a manual partial. Persist the first verified success
  time per provider refund, preserving it on replay. When provider evidence
  supplies the actual success time, preserve that time rather than discovery
  time. A refund's creation time is not its success time if it was pending.
  Historical evidence without a provable success time needs an explicit review
  decision; do not fabricate its date from today's read or move all pieces to
  the final operation completion. This date capture/read is still SQL work.
- Cash/terminal success is one event at the operation's `completed_at`, with
  its full amount and actual payout actor. No event before confirmation.
- A legacy succeeded Stripe operation with no attempt evidence may emit one
  event from its saved completion evidence only when that proves the full
  amount and date. Never emit a fallback alongside attempt coverage. Imported
  events retain `historical_log_id` so corte/trail skip money their logs already
  counted. Analytics includes only `kind=return`; corte/trail include both kinds.
- The client adds PostgREST filters on `succeeded_at`, `kind`, and
  `historical_log_id`, orders by unique `id`, and paginates with `range`.
  Date windows are `[from,to)` except the existing shift trail's inclusive end.
  Missing evidence or inconsistent money must fail the read, never look like
  a successful empty report. No data backfill is needed for finding 3.

Use `security definer set search_path = public` only with explicit revokes
from public/anon/authenticated and execute granted to service_role. Add the
new read to `supabase/drop.sql`. This is a new name; no old signature is dropped
by this worker. SQL must be accepted by Supabase's postgres role.

## Verification and product decisions

Each of findings 3, 5, 6, 9 and 7 first failed a targeted Vitest case. Only the
allowed local TypeScript, ESLint and Vitest checks were used. SQL answers are
mocked; these tests do not prove transaction, RLS or timestamp correctness.

No paying, selling, navigation or sign-out flow is blocked by these fixes.
Contradictory sale totals keep the existing manager-review behavior. Failed
financial reads ask for retry instead of presenting invented totals.

Claude's next task: implement/apply the event read and durable success dates,
combine with the returns SQL fixes, then run the full repository gate serially
against the owning checkout. Run dialogs because customer components changed.
Inspect the customer tracker in English and Spanish at 360/390/820/1280: paid,
returned and pending rows, partial manual and full returns. Inspect analytics,
corte and shift trails for a return split across local midnight. No worker
browser/layout result is claimed.

## Check results and commit blocker

- `npx tsc --noEmit -p .`: exit 0.
- `npx eslint <all changed .ts/.tsx/.mjs files>`: exit 0.
- `npx vitest run`: exit 1; 3121 passed, 1 failed, 410 test files.
  The only failure is the unchanged database invariant:
  `order_return_events_v1 is not in schema.sql`. Claude must add that SQL read
  before the required full suite can pass. It has not been waived or skipped.
- `git diff --check`: exit 0.
- `git add ...`: exit 128, unable to create
  `/Users/josuealmonasi/src/table-tap/.git/worktrees/tt-wt-ret-audit-ts/index.lock`:
  `Operation not permitted`. No commit, push or PR was created. The branch
  remains at `41fddb0e` and all edits remain in this worktree.

The final focused tracker/provider rerun also passed (17 cases). TypeScript
and lint are rechecked after the last source edit. After SQL integration and
restored Git write access, rerun the required checks and make separate commits
for 3, 5, 6, 9 and 7, including each finding's regression entry.

## Files changed

- `docs/SPEC.md`
- `docs/regressions.md`
- `docs/returns-audit-ts-handoff.md`
- `scripts/money-allocations.mjs`
- `src/components/customer/TrackedItemsCard.tsx`
- `src/components/customer/TrackerBody.tsx`
- `src/components/customer/__tests__/tracker-returns.spec.tsx`
- `src/lib/__tests__/allocation-review.spec.ts`
- `src/lib/__tests__/audit-l-s25b-account.spec.ts`
- `src/lib/__tests__/collected-today.spec.ts`
- `src/lib/__tests__/forgiveness-money.spec.ts`
- `src/lib/__tests__/offline-currency.spec.ts`
- `src/lib/__tests__/pos-atomic.spec.tsx`
- `src/lib/__tests__/pos-return-replay.spec.ts`
- `src/lib/__tests__/pos-sale.spec.ts`
- `src/lib/__tests__/report-currency.spec.ts`
- `src/lib/__tests__/return-event-dates.spec.ts`
- `src/lib/__tests__/return-events-fixture.ts`
- `src/lib/__tests__/returns-provider.spec.ts`
- `src/lib/__tests__/returns-readers.spec.ts`
- `src/lib/__tests__/returns-reporting.spec.ts`
- `src/lib/__tests__/shift-return-trail.spec.ts`
- `src/lib/__tests__/tracker-return-source.spec.ts`
- `src/lib/i18n/en.ts`
- `src/lib/i18n/es.ts`
- `src/lib/offline-sales.ts`
- `src/lib/order-tracking.ts`
- `src/lib/pos-sale.ts`
- `src/lib/receipt-return-source.ts`
- `src/lib/refunds/adjustments.ts`
- `src/lib/refunds/events.ts`
- `src/lib/refunds/operations.ts`
- `src/lib/refunds/reporting.ts`
- `src/lib/refunds/trail.ts`
