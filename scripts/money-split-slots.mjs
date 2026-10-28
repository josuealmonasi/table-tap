const cents = value => Math.round(Number(value ?? 0) * 100);
const sum = (rows, key) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
const index = rows => new Map(rows.map(row => [row.id, row]));

/** Slot → attempt → receipt → allocation; a missing link must fail the money gate. */
export function splitSlotProblems({ splits, slots, links, attempts, receipts, allocations, fees, refunds }) {
  const problems = [];
  const bySplit = index(splits.filter(s => s.model_version === 2));
  const byAttempt = index(attempts), byReceipt = index(receipts), byFee = index(fees);
  for (const split of bySplit.values()) {
    const parts = slots.filter(s => s.split_id === split.id);
    if (parts.length !== split.shares || sum(parts, "amount_cents") !== cents(split.amount)
      || sum(parts, "fee_slice_cents") !== split.fee_budget_cents
      || new Set(parts.map(s => s.share_no)).size !== split.shares) problems.push(`split ${split.id}: parts or fee budget disagree`);
    for (const part of parts) {
      if (part.restaurant_id !== split.restaurant_id) problems.push(`slot ${split.id}/${part.share_no}: tenant mismatch`);
      if (part.reserved_checkout_id) {
        const attempt = byAttempt.get(part.reserved_checkout_id);
        if (!attempt || attempt.status !== "open" || attempt.split_id !== split.id || attempt.restaurant_id !== split.restaurant_id
          || !links.some(l => l.checkout_id === attempt.id && l.split_id === split.id && l.share_no === part.share_no)) {
          problems.push(`slot ${split.id}/${part.share_no}: reservation has no matching open attempt`);
        }
      }
      if (part.payment_id) {
        const receipt = byReceipt.get(part.payment_id);
        if (!receipt || receipt.restaurant_id !== split.restaurant_id || receipt.session_id !== split.session_id || receipt.currency !== split.currency) {
          problems.push(`slot ${split.id}/${part.share_no}: receipt missing or outside the sitting/currency`);
        }
        if (part.reserved_checkout_id) problems.push(`slot ${split.id}/${part.share_no}: paid but still reserved`);
      }
    }
    for (const paymentId of new Set(parts.map(s => s.payment_id).filter(Boolean))) {
      const receipt = byReceipt.get(paymentId);
      if (!receipt) continue;
      const base = sum(parts.filter(s => s.payment_id === paymentId), "amount_cents");
      const attributed = allocations.filter(a => a.payment_id === paymentId);
      if (cents(receipt.amount) < base || Math.round(sum(attributed, "amount") * 100) !== cents(receipt.amount)
        || Math.round(sum(attributed, "tip") * 100) !== cents(receipt.tip)
        || attributed.some(a => a.restaurant_id !== split.restaurant_id || !split.order_ids.includes(a.order_id))) {
        problems.push(`receipt ${paymentId}: slot amount or allocation does not reconcile`);
      }
    }
  }
  for (const link of links) {
    const split = bySplit.get(link.split_id), attempt = byAttempt.get(link.checkout_id);
    const part = slots.find(s => s.split_id === link.split_id && s.share_no === link.share_no);
    if (!split || !attempt || !part || link.restaurant_id !== split.restaurant_id || attempt.restaurant_id !== split.restaurant_id
      || link.amount_cents !== part.amount_cents || link.fee_slice_cents !== part.fee_slice_cents) {
      problems.push(`checkout slot ${link.checkout_id}/${link.share_no}: immutable link disagrees`);
    }
  }
  for (const attempt of attempts.filter(a => a.split_id || a.metadata?.split_model === "2")) {
    const held = links.filter(l => l.checkout_id === attempt.id);
    if (!held.length) {
      // Opening precedes reservation. A page or paid attempt with no slots is
      // broken; an unbound open or refused attempt has not charged anybody.
      if (attempt.stripe_session_id || attempt.status === "paid") problems.push(`attempt ${attempt.id}: provider page has no slot links`);
      continue;
    }
    const split = bySplit.get(attempt.split_id);
    if (!split || attempt.currency !== split.currency || held.some(l => l.split_id !== split.id)
      || attempt.amount_cents !== sum(held, "amount_cents") + cents(attempt.metadata?.settle_tip)) {
      problems.push(`attempt ${attempt.id}: frozen slot amount or currency disagrees`);
    }
    const feeCents = Number(attempt.metadata?.fee_cents ?? 0);
    const fee = byFee.get(attempt.metadata?.fee_id);
    if (feeCents > sum(held, "fee_slice_cents") || (feeCents > 0 && (!fee || fee.cents !== feeCents || fee.restaurant_id !== attempt.restaurant_id))) {
      problems.push(`attempt ${attempt.id}: fee exceeds its parts or lacks its reservation`);
    }
    if (attempt.status !== "paid") continue;
    const returned = refunds.find(r => r.stripe_payment_intent === attempt.stripe_payment_intent);
    if (returned) {
      if (returned.restaurant_id !== attempt.restaurant_id || returned.currency !== attempt.currency || cents(returned.amount) !== attempt.amount_cents) {
        problems.push(`attempt ${attempt.id}: refund does not cover the full verified charge`);
      }
      continue;
    }
    const paid = receipts.filter(p => p.stripe_payment_intent === attempt.stripe_payment_intent && p.restaurant_id === attempt.restaurant_id);
    if (paid.length !== 1 || cents(paid[0].amount) !== attempt.amount_cents || paid[0].currency !== attempt.currency
      || held.some(l => !slots.some(s => s.split_id === l.split_id && s.share_no === l.share_no && s.payment_id === paid[0]?.id))) {
      problems.push(`attempt ${attempt.id}: paid charge has no exact slot receipt`);
    }
  }
  return problems;
}

export async function checkSplitSlots(db, { ok, bad }) {
  async function rows(table, fields, keys = ["id"]) {
    const result = [];
    for (;;) {
      let query = db.from(table).select(fields);
      for (const key of keys) query = query.order(key);
      const { data, error } = await query.range(result.length, result.length + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      if (!data?.length) return result;
      result.push(...data);
    }
  }
  try {
    const [splits, slots, links, attempts, receipts, allocations, fees, refunds] = await Promise.all([
      rows("bill_splits", "id,restaurant_id,session_id,model_version,shares,amount,fee_budget_cents,currency,order_ids"),
      rows("bill_split_slots", "*", ["split_id", "share_no"]),
      rows("bill_split_checkout_slots", "*", ["checkout_id", "split_id", "share_no"]),
      rows("diner_checkouts", "id,restaurant_id,split_id,split_revision,status,currency,amount_cents,metadata,stripe_session_id,stripe_payment_intent"),
      rows("payments", "id,restaurant_id,session_id,currency,amount,tip,stripe_payment_intent"),
      rows("payment_allocations", "id,restaurant_id,payment_id,order_id,amount,tip"),
      rows("platform_fees", "id,restaurant_id,cents,status"),
      rows("refunds_due", "id,restaurant_id,stripe_payment_intent,currency,amount"),
    ]);
    const problems = splitSlotProblems({ splits, slots, links, attempts, receipts, allocations, fees, refunds });
    for (const problem of problems) bad(problem);
    if (!problems.length) ok(`${slots.length} split slots and ${links.length} checkout links reconcile to attempts, receipts and allocations`);
  } catch (error) { bad(`cannot reconcile split slots: ${error.message}`); }
}
