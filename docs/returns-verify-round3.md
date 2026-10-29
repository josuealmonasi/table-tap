# Returns #575 — verification round 3

Reviewed base: `735327904a499896a882865893ea3d9f51877968`.
Branch: `codex/returns-audit-ts`.
V1, V5 and V7 refer to the round-2 follow-ups in
`docs/returns-verify-round2.md`. SQL verdicts below are read-only source
reasoning, with concrete input variations, not executed PostgreSQL results.
No SQL, grants, RLS, UI copy or function signatures changed in this round.
No existing explanatory comment was removed.

## Manual-only completion — fixed

`return-manual-completion.spec.ts` failed four cases before the fix: a
succeeded start reply, a succeeded reply with null app fields, zero outstanding
without an app attempt, and customer completion despite a fee recovery error.
Five controls passed already, including a fresh succeeded operation.

`operations.ts` now recognizes start's completion before checking fields used
to send an app refund. Fee recovery uses the tenant-scoped operation's saved
intent and account. No app row, new provider refund or finish call is needed.
Missing, incomplete and string-zero replies still cannot claim completion.
The focused executor/provider run passed all 30 cases after the fix.

Product decision: a fee recovery failure leaves customer completion intact.
Recovery remains pending under the existing queue/retry policy. Paying,
selling and signing out do not gain a new dependency.

## V1 — not fully closed

The round-2 full-charge fallback is corrected in
`finish_refund_due_attempt_v2` (`schema.sql:8607–8644`): the first ID starts
null and is selected only after excluding return-owned evidence. With input
`[return-owned 40, due-owned 100]`, coverage, attempt ID and header now use the
due's 100. Non-success input cannot newly save a return-owned ID there.

Variation that remains open: the other writer,
`record_refund_due_coverage_v1` (`schema.sql:8688–8703`), filters coverage but
still selects its header from the unfiltered `p_refunds[0]`. Start with a due
of 100, no unresolved due attempt and no saved header. Give it untagged,
succeeded manual refunds `[return-owned 40, unowned 100]` on the same charge.
`chargeRefundState` supplies both: it filters metadata, not local ownership
(`due-provider.ts:43–49`). The writer skips the 40, inserts the 100, reaches
full coverage, then stores the return-owned 40 on the due's header. That
reference can block the return's replay and is copied into a later legacy
due attempt by `start_refund_due_attempt` (`schema.sql:8226–8230`).

Minimal correction for Claude: select the header from coverage actually
accepted for this due, using the same ownership rule as the finisher.

## V5 — closed by source reasoning

The first transition to succeeded now calls `enqueue_fee_reconcile` inside
the completion transaction (`schema.sql:11955–11973`). That increments the
charge revision and persists a queue generation (`8553–8563`). The verifier
checks that revision under the same restaurant money lock before applying
anything (`6462–6471`). A snapshot from before completion is refused even if
its refund list contains the final header ID.

Variation checked: snapshot the older succeeded manual 40; attribute a newer
60 first and the older 40 last, making that older ID the completion header.
The stale reader still holds revision N; completion commits revision N+1.
It cannot clear verification with its 40-only target. A fresh recovery reads
both refunds. Replaying an already completed operation does not repeatedly
enqueue because the revision change is inside `o.status <> 'succeeded'`.

Unknown/dispatched fee requests are preserved by `prepare_fee_return`
(`schema.sql:8452–8460`), and a snapshot cannot erase a later queue generation
(`ack_fee_reconcile`, `8570–8576`). No database concurrency or provider result
is claimed by this review.

## V7 — not fully closed

The two-attempt-owner case now raises, and progress/events use the same
`refund ID, attempt number, attempt ID` tie-breaker
(`schema.sql:11926`, `12149–12153`, `12174`). These close the specific
two-attempt ownership and inconsistent selection examples from round 2.

Variation still open: two historical succeeded Stripe operations have only
headers, each naming `re_shared`, amount 100 and a valid completion date.
Both have zero attempts. The new ownership query groups only
`refund_attempts`, so it sees no conflict. Both progress reads return zero
through the header fallback (`11920–11921`). Both pass the reconciliation
assertion and emit 100 with the identical `refund:re_shared` ID through the
legacy branch (`12177–12186`). One header-only operation beside another
operation's attempt for that refund has the same gap. Reports count money
twice and the ID used for pagination is not unique.

The now deterministic selection also does not reject duplicate evidence for
one operation/refund with conflicting amounts or dates; it chooses the first
attempt. For example, two full-amount rows dated on different days pass the
total check and choose one day without raising. Consistent duplicates can
count once; contradictory financial evidence still needs a failed read.

Minimal correction for Claude: include legacy header ownership in the same
ownership check, and reject contradictory duplicate evidence before selecting
events. Keep emitted cents and progress on one rule. Do not pick a financial
history silently. Current writer checks do not prove older data is consistent.

## New — pending due replies lose their provider ID

`73532790` initializes `v_first` to null and only assigns it inside
`if p_status = 'succeeded'`. For a latest attempt with a null refund ID,
`finish_refund_due_attempt_v2(..., [{id: re_pending, amount_cents: 10000}],
'pending')` therefore writes `coalesce(null, null)` back to the attempt
(`schema.sql:8607–8634`). The prior version saved `re_pending`.

The TS caller explicitly expects this call to save the ID and retrieves that
ID on retry (`refund-due.ts:149–160`). It must now rediscover by metadata
instead. A metadata hit can recover it, so this is not proof of a duplicate
refund, but the durable provider identity has regressed. It affects
`requires_action` and failed/canceled evidence as well.

Minimal correction for Claude: preserve a verified, non-conflicting provider
ID for non-success outcomes without borrowing an ID from a return. Test
pending then succeeded retrieval, including a missing metadata-search result.
This SQL issue is reported only; it was not changed or executed here.

## Final sweep, including section 7 readers

Read preparation, immutable request/replay, discovery, manual attribution,
app execution, due fallback, failure reversal and charge-wide fee recovery.
The remaining actionable source findings are V1, V7 and the lost pending due
ID above. No additional TS change is proposed from this sweep.

Read the original-sale/component restoration, analytics and product revenue,
dated return summaries, corte/collected totals, shift trail, receipt and slot
receipt source, sealed reprints, customer tracker, offline replay and the
allocation money checker. Existing local tests cover manual 40 before final
60, exact local midnight, tenant/currency filtering, imported-log exclusion,
read failure, original sale restoration, partial receipt/tracker coverage and
reprint identity. These mocked boundaries do not exercise the SQL ownership
checks, legacy fallbacks or transaction races. V7's duplicate legacy events
reach the shared analytics/corte/trail reader, which validates cents and dates
but does not reject duplicate IDs. Receipts/tracker also trust succeeded
operation amounts rather than revalidating their provider evidence.

The shift trail retains its existing inclusive end; reporting and corte use
half-open periods. Manual evidence keeps the requested Stripe creation-date
policy from round 2; it is not a claim about its status-transition instant.

## Handoff

Final local checks after the last source change:

- Reproduction: `npx vitest run src/lib/__tests__/return-manual-completion.spec.ts`:
  exit 1 before the fix; four failed, five passed.
- Focused executor/provider Vitest: exit 0; three files, 30 tests passed.
- `npx vitest run`: exit 0; 413 files, 3,145 tests passed.
- `npx tsc --noEmit -p .`: exit 0.
- `npx eslint src/lib/refunds/operations.ts src/lib/__tests__/return-manual-completion.spec.ts`:
  exit 0.
- `git diff --check`: exit 0.

Commit blocked: `git add` exited 128 because Git could not create
`/Users/josuealmonasi/src/table-tap/.git/worktrees/tt-wt-ret-audit-ts/index.lock`
(`Operation not permitted`). Per the task instructions, all four files remain
uncommitted on `codex/returns-audit-ts` at `73532790`. No push or PR was made.

Claude's next task: correct the three SQL gaps above, reproduce their concrete
variations in PostgreSQL, and verify this TS commit together with the SQL.
This worker added no schema to apply and changed no RPC signature. After the
SQL changes, run the required full repository gates serially against Claude's
own checkout and database. Inspect a manual-only completed return in Bills
and Pedidos: it should complete immediately, with fee recovery allowed to
remain pending. No new copy needs translation or screen approval.
