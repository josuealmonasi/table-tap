# Card email UI handoff

Branch: `codex/card-email-ui`. Client only. No schema, grants, SQL signatures
or API handlers changed. All explanatory comments were kept.

Local staging was refused by the sandbox: this managed worktree's Git index
is under `/Users/josuealmonasi/src/table-tap/.git/worktrees/tt-wt-codex-cardui`.
No commit or push was made. Claude can review the working diff here and commit
it as `Add visit-card email ticket screens`; all checks below pass. Git
metadata remains unavailable to this sandbox.

## Contract to connect in Claude's server diff

- `/api/rewards?c=…`: include `email: string | null` for the diner holding the
  card code. This screen does not call the staff-only card-email GET.
- `/api/loyalty/attach?tableId=…` and `?orderId=…`: include the role-filtered
  `card.email: string | null` for an immediate collection notice. Existing
  attached cards also need that projection when new loyalty attachments are
  disabled, if their paid tickets still email automatically. A full card code
  is optional; staff can rescan to edit without a bearer code in bill reads.
- Card-email POST success must return the role-filtered address to staff too.
  The UI never substitutes the typed address for a masked response.
- POS and held replay bodies send `skipTicketEmail`. Map it in both the online
  writer and offline replay/approval writer before the paid insert/transition.
- Both table-payment routes receive `skipTicketEmail`. The calculator keeps it
  across a lost reply and resets it after a successful collection.
- Add the `/api/tickets/stop` POST separately. The new public page only sends
  the token after the diner presses the button.
- Divided slots use `/api/split/collect`, outside the supplied contract. No
  skip control is offered on that path. Decide its server contract separately
  if automatic slot tickets need a per-collection opt-out.

## Product choices

- A duplicate address names the other card's suffix. A suffix cannot select
  a bearer card, so the UI asks the diner to use it rather than guessing a code.
- Optional POS card saves have a three-second timeout. Refusal, a lost reply
  or missing consent never prevents charging; the existing per-sale email
  remains the fallback. Offline charging does not queue address changes.
- A newly entered per-sale address delivers today's ticket through the
  existing sender, with `skipTicketEmail: true` to prevent an automatic
  duplicate. This also covers a save that committed but lost its reply. Future
  sales use the card address automatically. Existing linked cards need no
  extra paper copy; choosing skip leaves the usual paper ticket behavior.
  "No ticket" skips automatic email too. Card-mail delivery failure/retry
  remains the server outbox's responsibility.
- A failed card-email read keeps payment available and offers a skip. An
  unknown address never becomes "no email" or a second per-sale recipient.
- Each mounted card reader gets a fresh cache key. Other readers refresh
  their own server-filtered answers after a save; they never receive a typed
  address broadcast from another reader.

## Local checks

Only focused specs and direct neighbours were run, with two workers. The
normal Vitest config bundler tried writing through the shared node_modules
symlink and was refused. CLI `--configLoader runner --cache=false` runs the
same specs without changing the repo config or writing there.

Specs cover creation/consent, diner edits/removal, stamp/lookup/attach,
role-filtered reads and delayed-cache privacy, till charge and held replay,
optional-save failure/duplicates, whole/counter/part collection, frozen retry
choices, and button-only unsubscribe. TypeScript and changed-file ESLint also
passed (exit 0), alongside 82 tests in 14 focused/neighbor spec files. No full
suite, DB or dev-server gate ran.

## Claude's gate plan

`loop/gate-policy.md` is absent in this checkout. The scoped plan below uses
the checked-in gate planner/scope rules and the client contract it exercises.
Run after combining the server implementation, against Claude's own server.

Client integration: `api`, `roles`, `smoke`, `layout`, `promises`, `dialogs`.
No client SQL/RLS or monetary calculation changed; choose `rls`, `money` and
`attack` from the combined server diff.

```bash
GATE_PAGES='["^/rewards$","^/tickets/stop$","^/r/[^/]+(/t/[^/]+)?$","^/order/[^/]+$","^/dashboard/(pos|bills|orders|table-order|loyalty|held-sales)$"]'
GATE_API='["^/api/rewards$","^/api/loyalty/(card|card-email|attach|stamp|lookup)$","^/api/pos/order$","^/api/table-bill$","^/api/table-payment(/part)?$","^/api/tickets/stop$"]'
```

Ensure the gate cases actually visit `/rewards` and `/tickets/stop`; a scoped
list cannot test a new page missing from its inventory. Inspect screenshots
at 360, 390, 820 and 1280px: long addresses, consent and privacy copy, duplicate
suffix, a masked cashier vs full owner/manager read, the skip and paper-ticket
choices, and unsubscribe success/404/retry. Verify one per-sale email and no
automatic duplicate while saving on the card, then automatic mail next sale.

## Files changed

- `docs/SPEC.md`
- `docs/card-email-ui-handoff.md`
- `docs/regressions.md`
- `src/app/tickets/stop/page.tsx`
- `src/components/customer/LoyaltyOffer.tsx`
- `src/components/customer/__tests__/card-email-create.spec.tsx`
- `src/components/dashboard/SettleTableDialog.tsx`
- `src/components/dashboard/TableCalculator.tsx`
- `src/components/dashboard/__tests__/card-email-collection.spec.tsx`
- `src/components/dashboard/__tests__/table-calculator-unanswered.spec.tsx`
- `src/components/dashboard/loyalty/AttachCard.react-component.tsx`
- `src/components/dashboard/loyalty/AttachedCardEmail.react-component.tsx`
- `src/components/dashboard/loyalty/CardLookupResult.tsx`
- `src/components/dashboard/loyalty/StampOutcome.tsx`
- `src/components/dashboard/loyalty/__tests__/attach-card.react-component.spec.tsx`
- `src/components/dashboard/loyalty/__tests__/card-email-staff.spec.tsx`
- `src/components/dashboard/pos/PosAsk.tsx`
- `src/components/dashboard/pos/PosCardEmail.react-component.tsx`
- `src/components/loyalty/BillTicketEmail.react-component.tsx`
- `src/components/loyalty/CardEmail.react-component.tsx`
- `src/components/loyalty/CardEmailFields.react-component.tsx`
- `src/components/loyalty/TicketEmailChoice.react-component.tsx`
- `src/components/loyalty/__tests__/card-email.spec.tsx`
- `src/components/rewards/RewardsCard.tsx`
- `src/components/rewards/RewardsLookup.tsx`
- `src/components/rewards/__tests__/card-email-rewards.spec.tsx`
- `src/components/tickets/StopTicketEmail.react-component.tsx`
- `src/components/tickets/__tests__/stop-ticket-email.spec.tsx`
- `src/hooks/__tests__/card-email-pos.spec.tsx`
- `src/hooks/useCardEmail.ts`
- `src/hooks/usePosCharge.ts`
- `src/hooks/usePosSaleDetails.ts`
- `src/lib/i18n/en.ts`
- `src/lib/i18n/es.ts`
- `src/lib/loyalty/save-sale-email.ts`
- `src/lib/offline-sales.ts`
