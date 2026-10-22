import { cents, time } from "./money-drawer-values.mjs";

/** Independent joins matching the terminal ledger, including imported whole-sale voids. */
export function terminalLedger(rows, restaurant, currency) {
  const mine = r => r.restaurant_id === restaurant;
  const receipts = rows.payments.filter(p => mine(p) && p.currency === currency
    && p.method === "card" && p.stripe_payment_intent == null).map(p => {
    const order = rows.orders.find(o => mine(o) && o.id === p.order_id);
    const legacyVoid = p.allocation_origin === "legacy" && order?.status === "cancelled"
      && !rows.order_adjustments.some(a => mine(a) && a.order_id === p.order_id);
    const tip = Number(p.tip) > 0 ? p.tip
      : order && Math.abs(Number(order.total) - Number(p.amount)) < 0.005 ? order.tip ?? 0 : 0;
    return { ...p, tip, payment_id: p.id, voided_at: legacyVoid ? order.cancelled_at ?? p.created_at : null };
  });
  const returns = [];
  for (const ra of rows.refund_allocations.filter(mine)) {
    const operation = rows.refund_operations.find(r => mine(r) && r.id === ra.operation_id
      && r.currency === currency && r.source === "terminal" && r.status === "succeeded" && r.completed_at);
    const allocation = rows.payment_allocations.find(a => mine(a) && a.id === ra.allocation_id);
    const payment = receipts.find(p => p.id === allocation?.payment_id);
    if (operation && payment) returns.push({ id: `return:${ra.id}`, payment_id: payment.id,
      amount: ra.amount, tip: ra.tip, created_at: payment.created_at,
      recorded_at: operation.completed_at, returned_at: operation.completed_at });
  }
  return { receipts, returns, events: [
    ...returns.map(r => ({ ...r, at: r.returned_at })),
    ...receipts.filter(p => p.voided_at).map(p => ({ ...p, id: `void:${p.id}`, at: p.voided_at })),
  ] };
}

export function compareTerminalLedger(expected, actual, bad) {
  const byId = new Map(actual.map(p => [p.id, p]));
  for (const p of [...expected.receipts, ...expected.returns]) {
    const r = byId.get(p.id);
    if (!r || cents(p.amount) !== cents(r.amount) || cents(p.tip) !== cents(r.tip)
      || p.payment_id !== r.payment_id || time(p.created_at) !== time(r.created_at)
      || time(p.recorded_at ?? p.created_at) !== time(r.recorded_at ?? r.created_at)
      || (p.returned_at ? time(p.returned_at) !== time(r.returned_at) : r.returned_at != null)
      || (p.voided_at ? time(p.voided_at) !== time(r.voided_at) : r.voided_at != null)) {
      bad(`receipt/return ${p.id} missing or changed in terminal ledger`);
    }
    byId.delete(p.id);
  }
  for (const id of byId.keys()) bad(`receipt/return ${id} has no raw receipt in terminal ledger`);
}
