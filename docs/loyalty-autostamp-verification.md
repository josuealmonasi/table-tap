# Loyalty payment implementation handoff

Branch: `claude/loyalty-autostamp`. Changes are local and uncommitted.
No pnpm, database, network, browser gates or edits under `supabase/` were used.

## Integration blocker for the schema owner

`supabase/schema.sql` defines `attach_loyalty_card_v1` and the payment trigger,
but its `pos_insert_order` helper does not persist `p_order.loyalty_card_id`.
Both `ring_pos_sale_v2` and `ring_pos_account_v2`, and the offline writer, call
that helper. The application now resolves the bearer code within the actor's
restaurant and supplies the id in the transaction payload. Claude must extend
the helper to validate and persist that id before payment settlement. Until
then, Caja can preview a card but its transaction cannot attach or stamp it.
The table/sitting attachment path uses the existing RPC directly.

Removal does not need another RPC: the application uses a conditional update
scoped to the restaurant and unpaid order/open sitting. Diner removal is also
conditioned on the card whose bearer code the diner holds.

## Verification

- `node_modules/.bin/vitest run --configLoader runner --no-cache`: exit 0;
  **525 files, 3,978 tests passed**, including **78 new tests in five files**.
- Direct ESLint on all changed/new TypeScript and JavaScript files:
  exit 0 with `--max-warnings=0`.
- Both new API script files pass `node --check`; 14 API cases are registered.
- `git diff --check`: exit 0.
- `node_modules/.bin/tsc --noEmit --incremental false`: exit 0 after the final full test run.

The normal Vitest config bundler tried to write through the shared
`node_modules` link and was blocked by the sandbox. The config runner avoids
that write. All reported passing test runs use the runner explicitly.

## Source fault plants

Each source mutation was actually applied, its focused suite exited 1, and
the original file was restored in a finally block before the next mutation.
The complete restored suite passed afterwards.

| Plant | Observed result |
| --- | --- |
| Allow kitchen attachment | Caught: exit 1; 1 failing assertion(s) |
| Accept another diner sitting | Caught: exit 1; 1 failing assertion(s) |
| Remove a card from a paid order | Caught: exit 1; 1 failing assertion(s) |
| Wrong outcome translation | Caught: exit 1; 1 failing assertion(s) |
| Offer a disabled program | Caught: exit 1; 1 failing assertion(s) |
| Replace Spanish heading with English | Caught: exit 1; 1 failing assertion(s) |
| Print the first code characters | Caught: exit 1; 1 failing assertion(s) |
| Never announce earned reward | Caught: exit 1; 1 failing assertion(s) |
| Print loyalty without a card | Caught: exit 1; 2 failing assertion(s) |
| Ignore the order card | Caught: exit 1; 1 failing assertion(s) |
| Drop the Caja transaction card | Caught: exit 1; 1 failing assertion(s) |

## Schema plants (in memory only)

The schema contract spec mutates copies of the trigger text and confirms each
copy fails its matching contract. These are text-contract checks, not executed
PostgreSQL trigger tests.

| Plant | Result |
| --- | --- |
| Remove paid inserts from trigger events | Rejected |
| Remove old-paid transition guard | Rejected |
| Remove cancelled-order guard | Rejected |
| Remove the sitting-card fallback | Rejected |
| Remove card/day conflict handling | Rejected |
| Remove same-restaurant card validation | Rejected |

## Decisions and open questions

- Schema integration above remains required; no schema changes were authorized.
- Offline paper prints the last four code characters and pending confirmation,
  because the device cannot know confirmed progress. Replay preserves the code
  and does not strand collected money if the card was subsequently deleted or
  switched off. SQL decides whether it can stamp when the sale is received.
- Existing schema uses the restaurant-local day when the trigger executes.
  For delayed offline sales, confirm whether that reception day is the intended
  policy; changing it belongs to the schema owner.
- Cards remain anonymous bearer capabilities: code possession proves card
  ownership; a separate live table credential proves sitting ownership.
- Live API cases, PostgreSQL payment/attachment races, the full release gate,
  promises, layout screenshots and dialogs remain for Claude's integration
  pass. No live or deployment readiness is claimed.

## Files

- `docs/SPEC.md`
- `docs/regressions.md`
- `scripts/api-cases.mjs`
- `scripts/api-cases/loyalty-attach.mjs`
- `scripts/api-loyalty-attachment-fixture.mjs`
- `src/app/api/loyalty/attach/__tests__/attach.react-component.spec.tsx`
- `src/app/api/loyalty/attach/route.ts`
- `src/app/api/pos/order/route.ts`
- `src/app/dashboard/table-order/page.tsx`
- `src/components/customer/BillSheet.tsx`
- `src/components/customer/DeviceBillCard.react-component.tsx`
- `src/components/dashboard/BillsPanel.tsx`
- `src/components/dashboard/SettleTableDialog.tsx`
- `src/components/dashboard/loyalty/AttachCard.react-component.tsx`
- `src/components/dashboard/loyalty/__tests__/attach-card.react-component.spec.tsx`
- `src/components/dashboard/pos/PosSalePanel.tsx`
- `src/components/dashboard/pos/PosScreen.tsx`
- `src/components/dashboard/waiter/PadOrderPanel.tsx`
- `src/components/dashboard/waiter/TableOrderScreen.tsx`
- `src/hooks/usePosCharge.ts`
- `src/hooks/usePosSaleDetails.ts`
- `src/lib/__tests__/invariants/orders.spec.ts`
- `src/lib/__tests__/loyalty-payment-schema.react-component.spec.tsx`
- `src/lib/__tests__/loyalty-receipt.react-component.spec.tsx`
- `src/lib/__tests__/loyalty-sale-card.react-component.spec.tsx`
- `src/lib/i18n/en.ts`
- `src/lib/i18n/es.ts`
- `src/lib/loyalty/attachment-server.ts`
- `src/lib/loyalty/attachment.ts`
- `src/lib/loyalty/receipt-source.ts`
- `src/lib/loyalty/receipt.ts`
- `src/lib/loyalty/sale-card.ts`
- `src/lib/offline-receipt.ts`
- `src/lib/offline-sales.ts`
- `src/lib/pos-offline.ts`
- `src/lib/pos-receipt.ts`
- `src/lib/pos-sale.ts`
- `src/lib/receipt-source.ts`
- `src/lib/receipt.ts`
- `docs/loyalty-autostamp-verification.md`
