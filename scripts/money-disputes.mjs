/** Database-only invariants. This does not discover a missed Stripe webhook. */
export function disputeStructuralErrors(cases, movements) {
  const errors = [];
  const seen = new Set();
  const caseKey = row => `${row.livemode}:${row.stripe_account_id}:${row.id}`;
  const byCase = new Map(cases.map(row => [caseKey(row), row]));
  for (const tx of movements) {
    const key = `${tx.livemode}:${tx.stripe_account_id}:${tx.stripe_balance_transaction_id}`;
    if (seen.has(key)) errors.push(`duplicate dispute transaction ${key}`);
    seen.add(key);
    if (![tx.amount_minor, tx.fee_minor, tx.net_minor].every(Number.isSafeInteger)
      || tx.amount_minor - tx.fee_minor !== tx.net_minor) errors.push(`dispute arithmetic ${key}`);
    const owner = byCase.get(caseKey({ ...tx, id: tx.dispute_id }));
    if (!owner || owner.restaurant_id !== tx.restaurant_id) errors.push(`dispute attribution ${key}`);
  }
  for (const dispute of cases) {
    const actual = movements.filter(tx => tx.dispute_id === dispute.id && tx.livemode === dispute.livemode && tx.stripe_account_id === dispute.stripe_account_id);
    const expected = dispute.verified_transaction_ids;
    if (!Array.isArray(expected) || new Set(expected).size !== expected.length
      || actual.length !== expected.length || actual.some(tx => !expected.includes(tx.stripe_balance_transaction_id))) {
      errors.push(`dispute transaction set ${caseKey(dispute)}`);
    }
  }
  return errors;
}

export async function checkDisputes(db, all, { ok, bad }) {
  const [{ data: cases, error: cErr }, { data: movements, error: mErr }, { data: pending, error: eErr }] = await Promise.all([
    all(() => db.from("stripe_disputes").select("id, restaurant_id, livemode, stripe_account_id, verified_transaction_ids, reconciliation_state")),
    all(() => db.from("stripe_dispute_movements").select("dispute_id, restaurant_id, livemode, stripe_account_id, stripe_balance_transaction_id, amount_minor, fee_minor, net_minor, currency")),
    all(() => db.from("stripe_dispute_events").select("id, state").neq("state", "done")),
  ]);
  if (cErr || mErr || eErr) return bad(`cannot read dispute books: ${(cErr ?? mErr ?? eErr).message}`);
  const errors = disputeStructuralErrors(cases, movements);
  errors.forEach(bad);
  if (!errors.length) ok(`dispute structural checks passed (${movements.length} transactions); provider completeness unverified`);
  console.log(`    –        disputes: ${pending.length} pending inbox events; ${cases.filter(d => d.reconciliation_state !== "reconciled").length} cases need reconciliation/review; historical discovery deferred to PR 3`);
}
