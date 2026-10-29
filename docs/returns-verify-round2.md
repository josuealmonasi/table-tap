# Returns #575 — verification round 2

Base: `703156720e650756b2f42588e246efa4fc96a71d`.
Branch: `codex/returns-audit-ts`.
Items V1–V7 below are the seven numbered follow-ups in
`loop/codex/verify-returns-answer.md`, not the earlier nine audit findings.
SQL verdicts are read-only source reasoning. No PostgreSQL execution, live
provider calls, server, database changes or live gates were used.

## Changes and regression checks

V6 now sends Stripe's `refund.created` as `succeeded_at` for succeeded manual
evidence, both on initial manager attribution and discovery replay.
`refundEvidence` defaults to app evidence; app attempts omit the field and
keep SQL's first-verification time. No RPC signature changed. No SQL or UI copy
changed, and no existing explanatory comment was removed.

- `returns-boundary.spec.ts`: the manager attribution case first failed for
  the missing timestamp. It now passes and proves a submitted client timestamp
  cannot replace the date retrieved from Stripe.
- `return-success-time.spec.ts`: succeeded manual evidence first failed for
  the missing timestamp; pending manual evidence and new/recovered app refunds
  omit it. All four cases pass.
- `refund-due-resume.spec.ts`: all three cases passed before the fix. A mocked
  SQL `partial` answer falls through to the saved unknown/pending attempt,
  keeps its amount and key, and retrieves its own provider ID when available.
  No change to `refund-due.ts` was needed. The scripted SQL answer is a
  boundary contract, not proof of the database's concurrency behavior.

## V1 — refund-ID ownership: not fully closed

All four previously missing ownership checks are present under the restaurant
lock. A return-owned refund alone cannot create due coverage, and the legacy
return finisher refuses a due-owned ID.

Breaking variation: due finish v2 receives full-charge fallback evidence
`[return-owned refund, due's refund]`. The first is skipped for coverage, but
`v_first` was taken from the unfiltered array. It still becomes the due
attempt's ID and, if the second refund covers the due, its header ID too
(`schema.sql:8610`, `8622`, `8630`, `8639`). The later return-side ownership
check now sees that due reference and can refuse replay of the return's own
manual evidence. A failure of the return-owned refund can also reopen the
fully covered due through its mislabelled latest attempt
(`schema.sql:6543–6561`). Coverage exclusivity alone does not close ownership
of the saved evidence.

Minimal correction: choose attempt/header evidence only from refunds accepted
for this due, and refuse ownership conflicts before persisting provider IDs,
including non-success outcomes. Keep the all-refund fallback from borrowing a
return's ID even when another refund supplies sufficient due coverage.

## V2 — due-side in-flight attribution: closed to the agreed rule

`record_refund_due_coverage_v1` discards incoming manual evidence while the
latest due attempt is unresolved (`schema.sql:8676`). The normal partial
answer reaches `start_refund_due_attempt_v2` and resumes its immutable request.
The three TS cases cover unknown, still-pending and recovered-success outcomes.

Breaking variation checked: manual evidence is present while the saved attempt
already has a provider ID. It must retrieve that ID, never open a smaller
replacement or report completion from the manual evidence. The TS does this.
An independent refund in Stripe can still coexist with the saved full app
request; this rule refuses to assign that manual refund to the same due. It
does not prevent an operator from making another refund in Stripe.

## V3 — mixed-refund replay: closed for consistent evidence

Saved manual evidence is checked for the same amount and attribution reference,
then continued before the unresolved-app guard (`schema.sql:12005–12014`).
Discovery accepts `partial`, so the saved app remainder can be retrieved and
finished through `operations.ts:64–116`.

Breaking variation checked: replay the saved manual 40 while the app 60 is
pending, then try a new manual refund. The unchanged 40 reaches app recovery;
new evidence still answers pending. A changed amount/reference conflicts.
V1's wrongly saved cross-ledger reference remains a separate way to block this
otherwise valid replay.

## V4 — legacy synthesis beside manual pieces: closed

`start_refund_attempt` synthesizes legacy full-amount evidence only when no
attempt of either origin exists (`schema.sql:6117–6124`).

Breaking variation checked: a stale executor reaches start after manual 40+60
completed the operation, with no app attempt. The manual rows prevent a
synthetic 100, so progress stays 100 rather than 140. A genuine no-attempt
legacy success still receives one row with its saved completion date.
The no-app response issue below does not recreate the duplicated money.

## V5 — stale fee snapshot: not closed

Matching the header closes the ordinary manual-40-then-app-60 example. It
does not prove the provider snapshot includes every contributing refund.

Breaking variation: a fee reader snapshots an older succeeded manual 40 and
pauses. A newer manual 60 succeeds. Attribute the newer 60 first, then the older
40 to complete the 100 operation. The last-attributed 40 has the newest
`updated_at`, so completion chooses its ID (`schema.sql:11959–11962`). The
old reader's refund list contains that ID and still matches
`apply_verified_platform_fee` (`schema.sql:6392`). Neither attribution nor
completion advances the fee epoch. The stale 40-only fee target can therefore
clear verification for the completed 100 operation, leaving the remaining fee
unprotected if recovery stops. This sequence uses ordinary separate manager
attributions; it needs no malformed provider response.

Minimal correction: invalidate snapshots atomically when accepted customer
coverage changes, or require the complete successful refund set rather than
one header ID. Keep unknown sends and failure epochs protected.

## V6 — manual evidence date: closed to the requested policy

Initial attribution and replay now pass the succeeded manual refund's provider
creation timestamp. App create and app recovery omit it. SQL accepts numeric
epoch seconds, caps them at now and preserves a saved attempt date.

Breaking variations checked: pending manual evidence, recovered app success
with an old creation date, and a forged browser timestamp. None supplies a
replacement date to SQL. The first two are covered by
`return-success-time.spec.ts`; the third by `returns-boundary.spec.ts`.

The policy is creation time for a currently succeeded manual refund and first
verification time for an app refund. Stripe documents `created` as creation
time, not a status-transition time:
https://docs.stripe.com/api/refunds/object. A manual refund that spent time
pending can therefore retain an earlier date; this change implements the
requested policy rather than proving its actual success instant.

## V7 — event coverage and failure behavior: not fully closed

Legacy header-only progress now reports zero outstanding. Missing header
evidence and completed operations whose progress differs from their amount
fail the read. Legacy/synthesized event IDs both use `refund:<provider ID>`.

Breaking variations remain:

- Two historical operations own the same refund ID, each for its full amount.
  Both progress reads are zero; events distinct by operation and refund emit
  both amounts with the same event ID (`schema.sql:12154`). The read neither
  fails the conflicting ownership nor supplies unique pagination identities.
  New writer guards do not repair or reject evidence admitted by old writers.
- App and manual evidence can share an attempt number because the unique key
  includes origin (`schema.sql:5645`). For duplicate historical evidence with
  different amounts or dates, progress orders only by refund ID/attempt number
  (`11924`); events additionally order by attempt ID (`12162`). The progress
  assertion can therefore validate a different piece from the emitted event.
  Adding the tie-breaker to events alone does not establish one coverage rule.

Minimal correction: use one deterministic coverage selection for progress and
events, reject conflicting duplicate amounts/dates and cross-operation owners,
and assert the emitted totals. Do not silently choose which financial evidence
to discard.

## Additional finding — completed manual-only reply can look pending

If the executor read a pending operation and a concurrent manager completes
it entirely through manual evidence, start now correctly creates no app row.
It consequently has no app attempt/account to return. `operations.ts:68–72`
rejects that result before checking `operation_status = succeeded`, answering
`completed: false` even though SQL already completed the operation. A later
fresh execution sees success and performs fee recovery. This is a response
and immediate-recovery gap, not a second refund. Keep the no-synthesis rule;
read completion independently of a nonexistent app attempt.

## Handoff

Final local checks after the last TypeScript edit:

- `npx vitest run`: exit 0; 412 files, 3,135 tests passed.
- `npx tsc --noEmit -p .`: exit 0, run after Vitest.
- `npx eslint` on `return-provider.ts`, `attribution.ts`,
  `return-success-time.spec.ts`, `refund-due-resume.spec.ts` and
  `returns-boundary.spec.ts`: exit 0.
- Focused Vitest run of those three test files: exit 0; 32 tests passed.
- `git diff --check`: exit 0.

Commit attempt: `git add` exited 128 because Git could not create
`/Users/josuealmonasi/src/table-tap/.git/worktrees/tt-wt-ret-audit-ts/index.lock`
(`Operation not permitted`). Per instruction, all changes remain uncommitted
on the named branch at `70315672`. Nothing was pushed and no PR was opened.

Claude must fix/review V1, V5 and V7 in SQL, reproduce their variations with
isolated database cases, then apply the combined schema and run the repository's
full gates serially in the owning checkout. No new SQL or signatures need
applying for this TS piece. No screen copy changed. The manual timestamp policy
above is the requested product choice; paying, selling and sign-out remain
unaffected.

Next bounded task: verify those SQL corrections and the no-app completion
response, then review Claude's database race and gate evidence before release.
