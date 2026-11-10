// Development SQL evidence only. Run after applying schema.sql, never in production.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import pg from "pg";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(path.join(repo, ".env.development.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const connectionString = process.env.DATABASE_URL ?? "";
if (process.argv.includes("--prod") || !url || !connectionString
  || `${url} ${connectionString}`.includes("vayymkzrvlepoksualku") || process.env.NODE_ENV === "production") {
  throw new Error("refusing to probe production or an unknown database");
}
// A pooler URL includes the project in its user; a direct URL includes it in
// the host. Require agreement with the explicitly loaded development project.
const project = new URL(url).hostname.split(".")[0];
if (!connectionString.includes(project)) throw new Error("development project and SQL connection differ");
const config = { connectionString, ssl: { rejectUnauthorized: false }, statement_timeout: 10000 };
const db = new pg.Client(config), peer = new pg.Client(config);
const restaurant = randomUUID(), foreign = randomUUID();
let pending;
const creditSql = "select account_credit_v1($1,$2,$3,$4,$5,$6,$7,$8) value";
const args = (order, amount = 1000, expected = 11000, request = randomUUID()) =>
  [restaurant, order, amount, expected, "error", "account-credit-probe", "probe", request];
const credit = async values => (await db.query(creditSql, values)).rows[0].value;
async function fixture() {
  const account = randomUUID(), order = randomUUID();
  await db.query("insert into customer_accounts(id,restaurant_id,name,code,credit_limit,opened_by) values($1,$2,'credit probe',$3,1000,'probe')",
    [account, restaurant, account.replaceAll("-", "").slice(0, 12).toUpperCase()]);
  await db.query("insert into orders(id,restaurant_id,account_id,status,subtotal,total,tip,service_fee,currency,charged_at) values($1,$2,$3,'completed',90,110,10,10,'MXN',now())",
    [order, restaurant, account]);
  return { account, order };
}
async function queued() {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    await db.query("select pg_stat_clear_snapshot()");
    const { rows } = await db.query("select exists(select 1 from pg_stat_activity where pg_backend_pid() = any(pg_blocking_pids(pid))) waiting");
    if (rows[0].waiting) return;
    await pause(20);
  }
  throw new Error("the peer did not wait behind the money lock");
}
try {
  await db.connect(); await peer.connect();
  await db.query("insert into restaurants(id,name,currency) values($1,'Credit probe','MXN'),($2,'Foreign credit probe','MXN')", [restaurant, foreign]);
  const f = await fixture(), request = args(f.order, 3300);
  const first = await credit(request);
  assert.equal(first.outcome, "credited"); assert.equal(first.remainingCents, 7700);
  assert.deepEqual(await credit(request), first);
  assert.equal((await credit([...request.slice(0, 2), 2000, ...request.slice(3)])).outcome, "conflict");
  const snapshot = (await db.query("select * from order_adjustments where id=$1", [first.adjustmentId])).rows[0];
  assert.equal(Number(snapshot.resulting_tip), 10); assert.equal(Number(snapshot.resulting_service_fee), 6.7);
  assert.equal((await credit(args(f.order, 100, 11000))).outcome, "changed");
  const fullRequest = args(f.order, 7700, 7700), full = await credit(fullRequest);
  assert.equal(full.remainingCents, 0); assert.deepEqual(await credit(fullRequest), full);
  const closed = (await db.query("select paid,written_off,total,tip,service_fee from orders where id=$1", [f.order])).rows[0];
  assert.equal(closed.paid, false); assert.equal(closed.written_off, true);
  assert.equal(Number(closed.total) + Number(closed.tip) + Number(closed.service_fee), 0);
  assert.equal((await db.query("select count(*)::int n from order_adjustments where order_id=$1", [f.order])).rows[0].n, 2);
  assert.equal((await db.query("select count(*)::int n from payments where restaurant_id=$1", [restaurant])).rows[0].n, 0);

  const legacy = await fixture();
  await db.query("update customer_accounts set credit_currency=null where id=$1", [legacy.account]);
  await db.query("update orders set currency='USD' where id=$1", [legacy.order]);
  assert.equal((await credit(args(legacy.order, 11000))).outcome, "credited");
  assert.equal((await db.query("select credit_currency from customer_accounts where id=$1", [legacy.account])).rows[0].credit_currency, "USD");

  const held = await fixture();
  const checkout = (await db.query("select account_checkout_currency_v1($1,$2,110,0,0,'MXN') value", [restaurant, held.account])).rows[0].value;
  assert.equal(checkout.outcome, "open");
  await db.query("update customer_accounts set checkout_until=now()-interval '1 hour' where id=$1", [held.account]);
  assert.equal((await credit(args(held.order))).outcome, "paying");
  assert.equal((await credit([foreign, ...args(held.order).slice(1)])).outcome, "missing");

  for (const winner of ["credit", "settle"]) {
    const f = await fixture();
    const settleSql = "select account_settle_currency_v1($1,$2,110,0,'cash','probe',$3,'MXN') value";
    const settleArgs = [restaurant, f.account, `probe:${randomUUID()}`];
    await db.query("begin"); await db.query("select lock_restaurant_money($1)", [restaurant]);
    pending = peer.query(winner === "credit" ? settleSql : creditSql, winner === "credit" ? settleArgs : args(f.order))
      .then(result => ({ result }), error => ({ error }));
    await queued();
    const won = winner === "credit" ? await credit(args(f.order)) : (await db.query(settleSql, settleArgs)).rows[0].value;
    assert.equal(won.outcome, winner === "credit" ? "credited" : "paid");
    await db.query("commit");
    const lost = await pending; pending = null;
    if (lost.error) throw lost.error;
    assert.equal(lost.result.rows[0].value.outcome, winner === "credit" ? "changed" : "ineligible");
    const { rows } = await db.query("select total,paid,(select count(*)::int from payments where account_id=$1) receipts,(select count(*)::int from order_adjustments where order_id=$2) credits from orders where id=$2", [f.account, f.order]);
    assert.equal(rows[0].paid, winner === "settle");
    assert.equal(Number(rows[0].total), winner === "credit" ? 100 : 110);
    assert.equal(rows[0].receipts, winner === "credit" ? 0 : 1);
    assert.equal(rows[0].credits, winner === "credit" ? 1 : 0);
  }
  console.log("PASS: partial/full credit, components, replay/conflict, stale balance, unresolved checkout, tenant isolation, both settle races");
} finally {
  await db.query("rollback").catch(() => {});
  if (pending) await pending;
  try { await db.query("delete from restaurants where id = any($1::uuid[])", [[restaurant, foreign]]); }
  finally { await Promise.allSettled([db.end(), peer.end()]); }
}
