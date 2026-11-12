/** Exact decimal cents, including unscaled historical SQL numeric values. */
export function journalCents(value) {
  const match = String(value).match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error(`invalid journal money: ${value}`);
  if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 100)) {
    throw new Error("unsafe journal decimal; read it as text");
  }
  const fraction = (match[2] ?? "").padEnd(3, "0");
  return BigInt(match[1]) * 100n + BigInt(fraction.slice(0, 2)) + (fraction[2] >= "5" ? 1n : 0n);
}
const integer = value => {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("unsafe journal integer; read it as text");
  return BigInt(value);
};
const identity = row => JSON.stringify([row.kind, row.order_id ?? null, row.payment_id ?? null, row.adjustment_id ?? null]);
const since = (date, cutoff) => date != null && date >= cutoff;

/** Pure source-to-journal AND journal-to-source reconciliation, per currency. */
export function reconcileAccountJournal({ accounts, orders, payments, adjustments, movements }, bad) {
  const cents = journalCents;
  for (const c of accounts) {
    const mine = movements.filter(m => m.account_id === c.id);
    if (!c.journal_started_at) {
      if (mine.length) bad(`unstarted account ${c.id} has movements`);
      continue;
    }
    const os = orders.filter(o => o.account_id === c.id);
    const ps = payments.filter(p => p.account_id === c.id);
    for (const row of [...os, ...ps]) if (row.restaurant_id !== c.restaurant_id) bad(`account source ${row.id} crosses tenants`);
    const ds = adjustments.filter(a => os.some(o => o.id === a.order_id));
    const expected = [];
    const add = (kind, source, amount, tip = 0n, service = 0n) => expected.push({ kind, ...source,
      amount_cents: amount, tip_cents: tip, service_cents: service,
      debt_delta_cents: ["collection", "credit"].includes(kind) ? -amount : amount });
    const original = o => {
      const reductions = ds.filter(a => a.order_id === o.id && since(a.created_at, c.journal_started_at)
        && ["account_credit", "return", "forgive"].includes(a.kind));
      const added = ps.filter(p => p.account_tip_order_id === o.id && since(p.created_at, c.journal_started_at))
        .reduce((sum, p) => sum + integer(p.account_added_tip_cents), 0n);
      const restored = field => reductions.reduce((sum, a) => sum + cents(a[`previous_${field}`]) - cents(a[`resulting_${field}`]), 0n);
      return [cents(o.total) + restored("total") - added,
        cents(o.tip) + restored("tip") - added, cents(o.service_fee) + restored("service_fee")];
    };
    for (const o of os.filter(o => since(o.charged_at, c.journal_started_at))) {
      add("charge", { order_id: o.id, currency: o.currency }, ...original(o));
    }
    for (const p of ps.filter(p => since(p.created_at, c.journal_started_at))) {
      add("collection", { payment_id: p.id, currency: p.currency }, cents(p.amount), cents(p.tip));
      if (integer(p.account_added_tip_cents) > 0n) {
        const o = os.find(o => o.id === p.account_tip_order_id);
        if (!o || o.currency !== p.currency || !p.allocation_scope?.includes(p.account_tip_order_id)) bad(`account tip source ${p.id} differs`);
        add("added_tip", { payment_id: p.id, order_id: p.account_tip_order_id, currency: p.currency },
          integer(p.account_added_tip_cents), integer(p.account_added_tip_cents));
      }
    }
    for (const a of ds.filter(a => since(a.created_at, c.journal_started_at))) {
      const o = os.find(o => o.id === a.order_id);
      const cancel = a.kind === "cancel" && !o.paid && !o.written_off && cents(a.previous_total) > 0n;
      if (a.kind !== "account_credit" && !cancel) continue;
      if (a.currency !== o.currency || a.restaurant_id !== c.restaurant_id) bad(`account credit source ${a.id} differs`);
      add("credit", { order_id: o.id, adjustment_id: a.id, currency: o.currency },
        cancel ? cents(a.previous_total) : integer(a.amount_cents),
        cents(a.previous_tip) - (cancel ? 0n : cents(a.resulting_tip)),
        cents(a.previous_service_fee) - (cancel ? 0n : cents(a.resulting_service_fee)));
    }
    const live = mine.filter(m => m.provenance === "live");
    for (const e of expected) {
      const matches = live.filter(m => identity(m) === identity(e));
      if (matches.length !== 1 || matches.some(m => m.currency !== e.currency || m.restaurant_id !== c.restaurant_id
        || m.refund_operation_id != null || ["amount_cents", "tip_cents", "service_cents", "debt_delta_cents"]
          .some(field => integer(m[field]) !== e[field]))) bad(`account ${c.id} ${identity(e)} missing, duplicated or different`);
    }
    for (const m of mine) {
      if (m.restaurant_id !== c.restaurant_id) bad(`account movement ${m.id} crosses tenants`);
      if (m.provenance === "live" && !expected.some(e => identity(e) === identity(m))) bad(`orphan account movement ${m.id}`);
      if (m.provenance !== "backfill") continue;
      const p = ps.find(p => p.id === m.payment_id);
      const a = ds.find(a => a.id === m.adjustment_id);
      if (m.kind === "opening") {
        if (!Array.isArray(m.charge_snapshot?.orders)) bad(`opening ${m.id} has no order snapshot`);
        for (const snapshot of m.charge_snapshot?.orders ?? []) {
          const o = os.find(o => o.id === snapshot.order_id);
          if (!o || o.currency !== m.currency || original(o).some((n, i) => n !==
            cents(snapshot[["current_total", "current_tip", "current_service"][i]]))) bad(`opening order ${snapshot.order_id} differs`);
        }
      }
      if (m.kind === "collection" && (!p || p.currency !== m.currency || cents(p.amount) !== integer(m.amount_cents)
        || cents(p.tip) !== integer(m.tip_cents) || integer(m.debt_delta_cents) !== 0n || !since(c.journal_started_at, p.created_at))) bad(`historical collection ${m.id} differs`);
      if (m.kind === "historical_observation" && (!a || a.kind !== "account_credit" || a.currency !== m.currency
        || integer(a.amount_cents) !== integer(m.amount_cents) || integer(m.debt_delta_cents) !== 0n)) bad(`historical credit ${m.id} differs`);
      if (!["opening", "collection", "historical_observation"].includes(m.kind)) bad(`unsupported historical movement ${m.id}`);
    }
    for (const currency of new Set([...mine.map(m => m.currency), ...os.map(o => o.currency)])) {
      const debt = os.filter(o => o.currency === currency && !o.paid && !o.written_off && o.status !== "cancelled")
        .reduce((sum, o) => sum + cents(o.total), 0n);
      const journal = mine.filter(m => m.currency === currency).reduce((sum, m) => sum + integer(m.debt_delta_cents), 0n);
      if (debt !== journal) bad(`account ${c.id} ${currency}: debt ${debt}, journal ${journal}`);
    }
  }
  for (const m of movements) if (!accounts.some(c => c.id === m.account_id)) bad(`account movement ${m.id} has no account`);
}

export async function checkAccountJournal(db, all, { ok, bad }) {
  const read = async (table, fields) => {
    const { data, error } = await all(() => db.from(table).select(fields));
    if (error) throw new Error(`${table}: ${error.message}`);
    return data;
  };
  const [accounts, orders, payments, adjustments, movements] = await Promise.all([
    read("customer_accounts", "id,restaurant_id,journal_started_at"),
    read("orders", "id,restaurant_id,account_id,currency,charged_at,total,tip,service_fee,paid,written_off,status"),
    read("payments", "id,restaurant_id,account_id,currency,created_at,amount,tip,account_added_tip_cents,account_tip_order_id,allocation_scope"),
    read("order_adjustments", "id,restaurant_id,order_id,currency,kind,created_at,amount_cents,previous_total,resulting_total,previous_tip,resulting_tip,previous_service_fee,resulting_service_fee"),
    read("account_movements", "id,restaurant_id,account_id,currency,kind,provenance,amount_cents,tip_cents,service_cents,debt_delta_cents,order_id,payment_id,adjustment_id,refund_operation_id,charge_snapshot"),
  ]);
  let problems = 0;
  reconcileAccountJournal({ accounts, orders, payments, adjustments, movements }, message => { problems++; bad(message); });
  if (!problems) ok(`account journal reconciled in both directions (${accounts.filter(c => c.journal_started_at).length} started accounts)`);
}
