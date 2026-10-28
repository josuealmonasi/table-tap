/** Read-only reconciliation of receipts, immutable coverage and returns. */
export async function checkAllocations(db, all, orders, payments, { ok, bad }) {
  async function rows(table, fields, filters = {}) {
    const { data, error } = await all(() => {
      let query = db.from(table).select(fields);
      for (const [key, value] of Object.entries(filters)) query = query.eq(key, value);
      return query;
    });
    if (error) throw new Error(`${table}: ${error.message}`);
    return data ?? [];
  }
  const [allocations, returns, operations, adjustments] = await Promise.all([
    rows("payment_allocations", "id, restaurant_id, payment_id, order_id, amount, tip"),
    rows("refund_allocations", "allocation_id, operation_id, amount, tip"),
    rows("refund_operations", "id, restaurant_id, adjustment_id, source, amount, tip, status, completed_at, stripe_refund_id"),
    rows("order_adjustments", "id, restaurant_id, order_id, kind, previous_total, resulting_total, previous_tip, resulting_tip, forgiven, currency, operation_ref"),
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
  const cancelled = new Set(adjustments.filter(a => a.kind === "cancel").map(a => a.order_id));
  const forgiven = adjustments.filter(a => a.kind === "forgive");
  // The adjustment is decimal SQL money. Math.round(1.005 * 100) loses a cent.
  const cents = value => {
    const match = String(value).match(/^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
    if (!match || String(value).length > 100) return NaN;
    const exponent = Number(match[4] ?? 0);
    if (Math.abs(exponent) > 100) return NaN;
    const point = match[2].length + exponent + 2;
    const digits = (match[2] + (match[3] ?? "")).padEnd(Math.max(point + 1, 0), "0");
    const rounded = (point > 0 ? Number(digits.slice(0, point)) : 0)
      + (point >= 0 && Number(digits[point]) >= 5 ? 1 : 0);
    const result = match[1] ? -rounded : rounded;
    return Number.isSafeInteger(result) ? result : NaN;
  };
  for (const a of forgiven) {
    const o = byOrder.get(a.order_id);
    const mine = allocations.filter(p => p.order_id === a.order_id && p.restaurant_id === a.restaurant_id);
    const reserved = returns.filter(r => mine.some(p => p.id === r.allocation_id));
    const retained = sum(mine, "amount") - sum(reserved, "amount");
    const tip = sum(mine, "tip") - sum(reserved, "tip");
    // Forgiveness freezes the paid bill before later returns lower it again.
    // Only this order's immutable return reductions change that snapshot.
    const later = adjustments.filter(r => r.kind === "return" && r.order_id === a.order_id && r.restaurant_id === a.restaurant_id);
    const totalAfterReturns = cents(a.resulting_total) - later.reduce((s, r) => s + cents(r.previous_total) - cents(r.resulting_total), 0);
    const tipAfterReturns = cents(a.resulting_tip) - later.reduce((s, r) => s + cents(r.previous_tip) - cents(r.resulting_tip), 0);
    if (!o || o.restaurant_id !== a.restaurant_id || !o.paid || o.written_off || o.status === "cancelled"
      || cents(o.total) !== totalAfterReturns || cents(o.tip) !== tipAfterReturns
      || retained !== totalAfterReturns || tip !== tipAfterReturns) bad(`forgiven order ${a.order_id} lacks resulting coverage`);
    // Match the writer's per-order cents, including unscaled legacy totals.
    if (!Number.isFinite(Number(a.forgiven)) || cents(a.forgiven) <= 0
      || cents(a.previous_total) - cents(a.resulting_total) !== cents(a.forgiven)
      || !["MXN", "USD"].includes(a.currency) || !a.operation_ref) bad(`forgiveness ${a.id} does not reconcile`);
  }
  // Whole losses have no adjustment row. SQL stamps them and the operation's
  // event in the same transaction, with the same actor, tenant and currency.
  const logs = await rows("user_logs", "id, restaurant_id, entity, action, detail, actor_email, created_at", { entity: "bill", action: "written_off" });
  const rest = logs.filter(l => l.entity === "bill" && l.action === "written_off" && /(?:^| )kind=rest(?: |$)/.test(l.detail ?? ""));
  const whole = rest.length ? (await rows("orders", "id, restaurant_id, total, currency, written_off, written_off_by, written_off_at", { written_off: true }))
    .filter(o => o.written_off) : [];
  const fields = detail => Object.fromEntries((detail ?? "").split(" ").map(part => {
    const at = part.indexOf("="); return at < 0 ? [] : [part.slice(0, at), part.slice(at + 1)];
  }).filter(pair => pair.length === 2));
  const sameOperation = (o, l) => o.restaurant_id === l.restaurant_id && o.written_off_by === l.actor_email
    && o.written_off_at && o.written_off_at === l.created_at && o.currency === fields(l.detail).currency;
  for (const a of forgiven) {
    const mine = rest.filter(l => l.id === a.operation_ref && l.restaurant_id === a.restaurant_id);
    if (mine.length !== 1 || fields(mine[0].detail).currency !== a.currency) bad(`forgiveness ${a.id} lacks one operation loss event`);
  }
  for (const l of rest) {
    const mine = forgiven.filter(a => a.operation_ref === l.id && a.restaurant_id === l.restaurant_id);
    const written = whole.filter(o => sameOperation(o, l));
    const ambiguous = written.some(o => rest.filter(other => sameOperation(o, other)).length !== 1);
    const loss = sum(mine, "forgiven") + written.reduce((sum, o) => sum + cents(o.total), 0);
    const amount = Number(fields(l.detail).amount);
    if (ambiguous || loss <= 0 || !Number.isFinite(amount) || cents(amount) !== loss
      || mine.some(a => a.currency !== fields(l.detail).currency)) bad(`write-off operation ${l.id} does not reconcile`);
  }
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
