import { DRAWER_ERA, cents, time } from "./money-drawer-values.mjs";

/** Rebuild the signed close without calling cash_shift_totals or close_cash_shift. */
export function checkClosedShifts(rows, { ok, bad, info }) {
  const closed = rows.cash_shifts.filter(s => s.closed_at != null);
  const shifts = closed.filter(s => time(s.closed_at) >= time(DRAWER_ERA));
  info(`    –        closed cash shifts: ${closed.length - shifts.length} skipped before ${DRAWER_ERA}`);
  let failures = 0;
  const fail = message => { failures++; bad(message); };
  for (const s of shifts) {
    const mine = r => r.restaurant_id === s.restaurant_id && r.currency === s.currency;
    const inside = at => time(at) >= time(s.opened_at) && time(at) <= time(s.closed_at);
    const receipts = rows.payments.filter(p => mine(p) && p.method === "cash" && p.actor_email
      && inside(p.created_at) && time(p.recorded_at ?? p.created_at) <= time(s.closed_at));
    const returns = rows.refund_operations.filter(r => mine(r) && r.source === "cash"
      && r.status === "succeeded" && r.payout_actor && inside(r.completed_at));
    const withdrawals = rows.cash_movements.filter(m => mine(m) && m.shift_id === s.id
      && m.kind === "withdrawal" && time(m.created_at) <= time(s.closed_at));
    let oldReturns = 0;
    for (const l of rows.user_logs) {
      if (l.restaurant_id !== s.restaurant_id || l.action !== "refunded" || !inside(l.created_at)
        || rows.refund_operations.some(r => r.restaurant_id === s.restaurant_id && r.historical_log_id === l.id)) continue;
      const field = name => new RegExp(`(?:^| )${name}=([^ ]+)`).exec(l.detail ?? "")?.[1];
      if (field("method") !== "cash" || !field("collector")) continue;
      const orders = rows.orders.filter(o => o.restaurant_id === s.restaurant_id && o.id.slice(0, 8) === field("order"));
      const currency = field("currency") ?? (orders.length === 1 ? orders[0].currency : s.currency);
      const amount = /(?:^| )amount=([0-9]+(?:[.][0-9]+)?)(?: |$)/.exec(l.detail ?? "")?.[1];
      if (currency === s.currency && amount != null) oldReturns += cents(amount);
    }
    const sum = records => records.reduce((n, r) => n + cents(r.amount), 0);
    const expected = cents(s.opening_amount) + sum(receipts) - sum(returns) - oldReturns - sum(withdrawals);
    if (!s.currency || !Number.isFinite(expected) || cents(s.expected_cash) !== expected) {
      fail(`shift ${s.id} expected cash ${s.expected_cash} disagrees with ledger ${(expected / 100).toFixed(2)} ${s.currency}`);
    }
    if (cents(s.difference) !== cents(s.counted_cash) - expected) fail(`shift ${s.id} counted difference disagrees with its signed expected cash`);
  }
  if (!failures) ok(`closed cash shifts reconcile (${shifts.length} checked)`);
}
