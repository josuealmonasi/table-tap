import { DRAWER_ERA, cents, time } from "./money-drawer-values.mjs";
import { terminalLedger, compareTerminalLedger } from "./money-terminal-ledger.mjs";

const dayOf = (at, zone) => new Intl.DateTimeFormat("en-CA", {
  timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(at));
const fee = (amount, pct) => Math.round(amount * Number(pct) / 100 + 1e-7);
const cutoff = d => time(d.snapshot_at ?? d.created_at);

/** Signed manifests are immutable. Unnamed receipts remain explicit late adjustments. */
export function checkTerminalDeposits(rows, { ok, bad, info }) {
  const deposits = rows.terminal_deposits.filter(d => time(d.created_at) >= time(DRAWER_ERA));
  info(`    –        terminal deposits: ${rows.terminal_deposits.length - deposits.length} skipped before ${DRAWER_ERA}`);
  let failures = 0, adjustments = 0, pendingReturns = 0;
  const fail = message => { failures++; bad(message); };
  for (const [key, projected] of rows.terminal_ledger) {
    const [restaurant, currency] = JSON.parse(key);
    const config = rows.restaurants.find(r => r.id === restaurant);
    if (!config) { fail(`terminal deposits ${restaurant} have no restaurant`); continue; }
    const day = at => dayOf(at, config.timezone ?? "America/Mexico_City");
    const marks = rows.terminal_deposits.filter(d => d.restaurant_id === restaurant && d.currency === currency);
    const modern = deposits.filter(d => marks.includes(d));
    const ledger = terminalLedger(rows, restaurant, currency);
    compareTerminalLedger(ledger, projected, fail);
    const receipts = new Map(ledger.receipts.map(p => [p.id, p]));
    const events = new Map(ledger.events.map(r => [r.id, r]));
    const paymentOwners = new Map(), returnOwners = new Map();
    for (const d of marks) {
      for (const [ids, owners, label] of [[d.payment_ids, paymentOwners, "receipt"], [d.return_ids, returnOwners, "return"]]) {
        for (const id of ids ?? []) {
          if (owners.has(id)) fail(`${label} ${id} appears in deposits ${owners.get(id)} and ${d.id}`);
          owners.set(id, d.id);
        }
      }
    }
    for (const d of modern) {
      if (!d.currency || !d.snapshot_at || !Array.isArray(d.payment_ids) || !Array.isArray(d.return_ids)
        || d.fee_pct == null || !Number.isFinite(Number(d.fee_pct)) || Number(d.fee_pct) < 0) {
        fail(`deposit ${d.id} lacks its signed snapshot`); continue;
      }
      let gross = 0, sameDayReturns = 0, carried = 0;
      for (const id of d.payment_ids) {
        const p = receipts.get(id);
        if (!p || day(p.created_at) !== d.sales_day || time(p.recorded_at ?? p.created_at) > cutoff(d)) {
          fail(`deposit ${d.id} receipt ${id} is outside its day/currency/cutoff`); continue;
        }
        gross += cents(p.amount);
      }
      for (const id of d.return_ids) {
        const r = events.get(id);
        if (!r || time(r.at) > cutoff(d) || day(r.at) > d.sales_day) {
          fail(`deposit ${d.id} return ${id} is outside its cutoff`); continue;
        }
        const saleDay = day(r.created_at), returnDay = day(r.at);
        if (saleDay === returnDay && saleDay === d.sales_day) {
          if (!d.payment_ids.includes(r.payment_id)) fail(`deposit ${d.id} return ${id} lacks receipt ${r.payment_id}`);
          sameDayReturns += cents(r.amount);
        } else {
          const original = marks.find(m => m.sales_day === saleDay);
          carried += cents(r.amount) - (saleDay === returnDay ? fee(cents(r.amount), original?.fee_pct ?? d.fee_pct) : 0);
        }
      }
      const net = gross - sameDayReturns;
      const expected = net - fee(net, d.fee_pct) - carried;
      if (cents(d.expected) !== expected) fail(`deposit ${d.id} expected ${d.expected} disagrees with receipts/returns ${(expected / 100).toFixed(2)} ${currency}`);

      // Rebuild the return assignment as it stood before this mark. Checking
      // only the named returns would let an omitted refund flatter the bank.
      const prior = marks.filter(m => m !== d && cutoff(m) <= cutoff(d));
      const signedDays = new Set(prior.map(m => m.sales_day));
      const salesDays = [...new Set(ledger.receipts.filter(p => time(p.recorded_at ?? p.created_at) <= cutoff(d)
        && cents(p.amount) - ledger.events.filter(r => r.payment_id === p.id && day(r.at) === day(p.created_at)
          && time(r.at) <= cutoff(d) && !signedDays.has(day(p.created_at))).reduce((n, r) => n + cents(r.amount), 0) > 0)
        .map(p => day(p.created_at)))].sort();
      for (const r of ledger.events.filter(r => time(r.at) <= cutoff(d))) {
        const returnDay = day(r.at), saleDay = day(r.created_at);
        const consumed = prior.some(m => m.return_ids?.includes(r.id) || (m.return_ids == null
          && time(r.at) <= time(m.created_at) && m.sales_day === salesDays.find(s => s >= returnDay)));
        if (consumed) continue;
        const sameDay = saleDay === returnDay && !signedDays.has(saleDay);
        const target = sameDay ? saleDay : salesDays.find(s => s >= returnDay && !signedDays.has(s));
        if (target === d.sales_day && !d.return_ids.includes(r.id)) fail(`deposit ${d.id} is missing return ${r.id}`);
      }
    }
    for (const p of ledger.receipts) {
      const original = marks.find(d => d.sales_day === day(p.created_at));
      if (!original || !modern.includes(original) || paymentOwners.has(p.id)) continue;
      // Membership wins over recorded_at: a transaction can be dated before
      // it waits for the money lock, yet insert after the signed manifest.
      adjustments++;
      const sameDay = ledger.events.filter(r => r.payment_id === p.id && day(r.at) === day(p.created_at)
        && original.return_ids?.includes(r.id)).reduce((n, r) => n + cents(r.amount), 0);
      const amount = cents(p.amount) - sameDay;
      info(`    REVIEW   late receipt ${p.id}: deposit ${original.id} adjustment ${((amount - fee(amount, original.fee_pct)) / 100).toFixed(2)} ${currency}`);
    }
    for (const r of ledger.events) {
      if (returnOwners.has(r.id) || !modern.some(d => d.sales_day === day(r.created_at))) continue;
      // A return without an unsigned sales day has no deposit to name yet,
      // even when another day's later cutoff exists. Keep that debt visible.
      pendingReturns++;
      const original = marks.find(d => d.sales_day === day(r.created_at));
      const amount = cents(r.amount);
      const debit = amount - (day(r.at) === day(r.created_at) ? fee(amount, original?.fee_pct ?? config.terminal_fee_pct) : 0);
      info(`    REVIEW   terminal return ${r.id}: awaiting a later deposit (${(debit / 100).toFixed(2)} ${currency})`);
    }
  }
  if (!failures) {
    ok(`terminal deposits reconcile (${deposits.length} checked)`);
    ok(`late terminal receipts remain adjustments (${adjustments} checked)`);
    ok(`pending terminal returns remain visible (${pendingReturns} checked)`);
  }
}
