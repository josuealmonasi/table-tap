/** Read-only reconciliation of receipts, immutable coverage and returns. */
export async function checkAllocations(db, all, orders, payments, { ok, bad }) {
  async function rows(table, fields) {
    const { data, error } = await all(() => db.from(table).select(fields));
    if (error) throw new Error(`${table}: ${error.message}`);
    return data;
  }
  const [allocations, returns, operations, adjustments] = await Promise.all([
    rows("payment_allocations", "id, restaurant_id, payment_id, order_id, amount, tip"),
    rows("refund_allocations", "allocation_id, operation_id, amount, tip"),
    rows("refund_operations", "id, restaurant_id, adjustment_id, source, amount, tip, status, completed_at, stripe_refund_id"),
    rows("order_adjustments", "id, restaurant_id, order_id"),
  ]);
  const sum = (rs, key) => rs.reduce((s, r) => s + Math.round(Number(r[key]) * 100), 0);
  const byOrder = new Map(orders.map(o => [o.id, o]));
  const modern = new Set();
  let exceptions = payments.filter(p => p.allocation_version === 0 || p.allocation_quality === "unresolved").length;
  for (const p of payments.filter(p => p.allocation_version === 1)) {
    const mine = allocations.filter(a => a.payment_id === p.id);
    if (sum(mine, "amount") + Math.round(Number(p.unallocated_amount) * 100) !== Math.round(Number(p.amount) * 100)
      || sum(mine, "tip") + Math.round(Number(p.unallocated_tip) * 100) !== Math.round(Number(p.tip) * 100)) bad(`receipt ${p.id} does not reconcile`);
    for (const a of mine) {
      if (a.restaurant_id !== p.restaurant_id || byOrder.get(a.order_id)?.restaurant_id !== a.restaurant_id) bad(`allocation ${a.id} crosses tenants`);
      modern.add(a.order_id);
    }
  }
  for (const a of allocations) {
    const mine = returns.filter(r => r.allocation_id === a.id);
    if (sum(mine, "amount") > Math.round(Number(a.amount) * 100)
      || sum(mine, "tip") > Math.round(Number(a.tip) * 100)
      || sum(mine, "amount") - sum(mine, "tip") > Math.round((Number(a.amount) - Number(a.tip)) * 100)) bad(`allocation ${a.id} was returned twice`);
  }
  for (const o of operations) {
    const mine = returns.filter(r => r.operation_id === o.id);
    if (o.source !== "review" && (sum(mine, "amount") !== Math.round(Number(o.amount) * 100)
      || sum(mine, "tip") !== Math.round(Number(o.tip) * 100))) bad(`return ${o.id} does not reconcile`);
    if (o.status === "succeeded" && (!o.completed_at || (o.source === "stripe" && !o.stripe_refund_id))) bad(`return ${o.id} lacks completion evidence`);
    if (o.status !== "succeeded") {
      exceptions++;
      console.log(`    REVIEW   return ${o.id}: ${o.status}, ${o.amount}`);
    }
  }
  const cancelled = new Set(adjustments.map(a => a.order_id));
  for (const id of modern) {
    const o = byOrder.get(id);
    const mine = allocations.filter(a => a.order_id === id);
    const reserved = returns.filter(r => mine.some(a => a.id === r.allocation_id));
    const retained = sum(mine, "amount") - sum(reserved, "amount");
    const tip = sum(mine, "tip") - sum(reserved, "tip");
    const unknown = mine.some(a => payments.some(p => p.id === a.payment_id && p.allocation_origin === "legacy" && p.breakdown_unknown));
    if (unknown) {
      exceptions++;
      console.log(`    REVIEW   order ${id}: historical principal/tip breakdown unknown`);
    } else if (o.paid && !o.written_off && o.status !== "cancelled"
      && (tip !== Math.round(Number(o.tip) * 100) || retained - tip !== Math.round((Number(o.total) - Number(o.tip)) * 100))) {
      bad(`settled order ${id} lacks principal or tip coverage`);
    }
    if (o.paid && !o.written_off && o.status !== "cancelled" && retained !== Math.round(Number(o.total) * 100)) bad(`settled order ${id} lacks exact retained coverage`);
    if (o.status === "cancelled" && cancelled.has(id) && retained !== 0) bad(`cancelled order ${id} lacks a return obligation`);
  }
  ok(`${payments.length} receipt(s), ${allocations.length} allocations and ${operations.length} returns checked`);
  if (exceptions) console.log(`    REVIEW   ${exceptions} unresolved historical receipt(s) / outstanding return(s); these are not a clean reconciliation`);
  return { modern, cancelled, exceptions };
}
