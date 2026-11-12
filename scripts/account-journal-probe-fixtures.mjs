import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";

export async function account(db, restaurant) {
  const id = randomUUID();
  await db.query("insert into customer_accounts(id,restaurant_id,name,code,credit_limit,opened_by) values($1,$2,'Journal probe',$3,1000,'probe')",
    [id, restaurant, id.replaceAll("-", "").slice(0, 12).toUpperCase()]);
  return id;
}
export async function order(db, restaurant, owner, total, currency = "MXN", charged = true, tip = 0, service = 0) {
  assert.equal(charged, true, "Unknown history belongs only in dormantOrder");
  const id = randomUUID();
  await db.query(`insert into orders(id,restaurant_id,status,subtotal,total,tip,service_fee,currency)
    values($1,$2,'completed',$3-$5-$6,$3,$5,$6,$4)`, [id, restaurant, total, currency, tip, service]);
  const { rows } = await db.query("select account_charge_v2($1,$2,$3,$4,'probe') value", [restaurant, owner, [id], total]);
  assert.equal(rows[0].value.outcome, "charged");
  return id;
}

// Historical evidence only: the writer cannot invent an unknown charge date
// or import mixed-currency debt. Never use this helper for a live fixture.
async function dormantOrder(db, restaurant, owner, total, currency, charged) {
  const { rows } = await db.query(`select c.journal_started_at, r.account_journal_started_at
    from customer_accounts c join restaurants r on r.id=c.restaurant_id
    where c.id=$1 and r.id=$2`, [owner, restaurant]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].journal_started_at, null);
  assert.equal(rows[0].account_journal_started_at, null);
  const id = randomUUID();
  const inserted = await db.query(`insert into orders(id,restaurant_id,account_id,status,subtotal,total,currency,charged_at)
    select $1,$2,$3,'completed',$4,$4,$5,case when $6 then now() else null end
    from customer_accounts c join restaurants r on r.id=c.restaurant_id
    where c.id=$3 and r.id=$2 and c.journal_started_at is null and r.account_journal_started_at is null`,
    [id, restaurant, owner, total, currency, charged]);
  assert.equal(inserted.rowCount, 1, "Historical import requires a dormant account and restaurant");
  return id;
}
export async function settle(db, restaurant, owner, total) {
  const { rows } = await db.query("select account_settle_currency_v1($1,$2,$3,0,'cash','probe',$4,'MXN') value",
    [restaurant, owner, total, `journal-probe:${randomUUID()}`]);
  assert.equal(rows[0].value.outcome, "paid");
}
export async function fixture(db, restaurant) {
  const owner = await account(db, restaurant);
  await order(db, restaurant, owner, 45, "MXN", true, 5, 5);
  await settle(db, restaurant, owner, 45);
  const partial = await order(db, restaurant, owner, 110, "MXN", true, 10, 10);
  const full = await order(db, restaurant, owner, 110, "MXN", true, 10, 10);
  for (const [id, amount] of [[partial, 3300], [full, 11000]]) {
    const { rows } = await db.query("select account_credit_v1($1,$2,$3,11000,'error','journal probe','probe',$4) value",
      [restaurant, id, amount, randomUUID()]);
    assert.equal(rows[0].value.outcome, "credited");
  }
  const cancelled = await order(db, restaurant, owner, 20);
  await db.query("update orders set status='cancelled' where id=$1", [cancelled]);
  const unknown = await dormantOrder(db, restaurant, owner, 30, "MXN", false);
  await dormantOrder(db, restaurant, owner, 13, "USD", true);
  return { owner, partial, full, unknown };
}
export async function opening(db, restaurant, owner) {
  const { rows } = await db.query(`select currency,coalesce(sum(round(total*100)),0)::text debt from orders
    where restaurant_id=$1 and account_id=$2 and not paid and not written_off and status <> 'cancelled'
    group by currency order by currency`, [restaurant, owner]);
  return Object.fromEntries(rows.map(row => [row.currency, row.debt]));
}
export async function movement(db, restaurant, owner, source, overrides = {}) {
  const row = { restaurant_id: restaurant, account_id: owner, currency: "MXN", kind: "charge", amount_cents: 1,
    debt_delta_cents: 1, occurred_at: new Date(), operation_ref: randomUUID(), order_id: source,
    provenance: "live", charge_snapshot: {}, ...overrides };
  return db.query(`insert into account_movements(${Object.keys(row).join(",")})
    values(${Object.keys(row).map((_, i) => `$${i + 1}`).join(",")})`, Object.values(row));
}
export async function refused(db, action, pattern) {
  await db.query("begin");
  try { await assert.rejects(action, pattern); }
  finally { await db.query("rollback"); }
}
export async function queued(db, peerPid) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    await db.query("select pg_stat_clear_snapshot()");
    const { rows } = await db.query("select pg_backend_pid() = any(pg_blocking_pids($1)) waiting", [peerPid]);
    if (rows[0].waiting) return;
    await pause(20);
  }
  throw new Error("the peer did not wait behind this connection's money lock");
}
export async function backfill(db, restaurant) {
  // PR 2 must choose the exact cutoff AFTER acquiring the money lock.
  await db.query("select lock_restaurant_money($1)", [restaurant]);
  const { rows } = await db.query("select * from account_journal_backfill_v1($1,clock_timestamp())", [restaurant]);
  return rows;
}
