// Development SQL evidence only. Apply schema.sql first. Creates isolated fixtures.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import pg from "pg";

// Production-refusing guard copied from probe-account-credit.mjs.
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
const db = new pg.Client(config), opener = new pg.Client(config), collector = new pg.Client(config);
const clients = [db, opener, collector], restaurants = [randomUUID(), randomUUID()];
const [restaurant, foreign] = restaurants;
const pending = [];
const value = async (client, sql, args) => (await client.query(sql, args)).rows[0].value;
const closeSql = "select close_cash_shift_once($1,$2,$3,'probe',$4) value";
const open = client => value(client, "select open_cash_shift($1,'probe',0) value", [restaurant]);
const totals = shift => value(db, "select cash_shift_totals($1,$2,clock_timestamp()) value", [restaurant, shift]);
function launch(client, sql, args) {
  const promise = client.query(sql, args).then(result => ({ result }), error => ({ error }));
  pending.push(promise);
  return promise;
}
async function finish(promise) {
  const { result, error } = await promise;
  if (error) throw error;
  return result.rows[0].value;
}
async function queued(pid) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    await db.query("select pg_stat_clear_snapshot()");
    const { rows } = await db.query("select cardinality(pg_blocking_pids($1)) > 0 waiting", [pid]);
    if (rows[0].waiting) return;
    await pause(20);
  }
  throw new Error("the peer did not wait behind the money lock");
}
async function queue(client, method = "cash", tenant = restaurant) {
  const ref = randomUUID();
  const body = { posRef: ref, restaurantId: tenant, method, offline: { total: 100 } };
  const result = await value(client, "select queue_offline_sale($1,$2,$3,'probe','MXN','probe','cash probe') value", [tenant, ref, body]);
  assert.equal(result.queued, true);
  return ref;
}
try {
  await Promise.all(clients.map(client => client.connect()));
  const openerPid = (await opener.query("select pg_backend_pid() pid")).rows[0].pid;
  const collectorPid = (await collector.query("select pg_backend_pid() pid")).rows[0].pid;
  await db.query("insert into restaurants(id,name,plan,plan_status,currency) values($1,'Cash probe','servicio','active','MXN'),($2,'Foreign cash probe','servicio','active','MXN')", restaurants);

  // F1: close A owns the lock; opening B queues first; collection queues next.
  const shiftA = await open(db), table = randomUUID(), session = randomUUID(), order = randomUUID();
  await db.query("insert into restaurant_tables(id,restaurant_id,label) values($1,$2,'Cash probe')", [table, restaurant]);
  await db.query("insert into table_sessions(id,restaurant_id,table_id) values($1,$2,$3)", [session, restaurant, table]);
  await db.query("insert into orders(id,restaurant_id,table_id,session_id,status,subtotal,total,currency) values($1,$2,$3,$4,'received',100,100,'MXN')", [order, restaurant, table, session]);
  const offlineAt = (await db.query("select clock_timestamp() at")).rows[0].at;
  await db.query("begin");
  await db.query("select lock_restaurant_money($1)", [restaurant]);
  const opening = launch(opener, "select open_cash_shift($1,'probe',0) value", [restaurant]);
  await queued(openerPid);
  await collector.query("begin");
  const collection = launch(collector, "select collect_table_reviewed_v1($1,$2,100,'MXN',100,20,'cash','probe',$3) value", [restaurant, table, `probe:${randomUUID()}`]);
  await queued(collectorPid);
  const closedA = await value(db, closeSql, [restaurant, shiftA, 0, randomUUID()]);
  assert.equal(closedA.expected, 0);
  await db.query("commit");
  const shiftB = await finish(opening);
  assert.ok(shiftB);
  assert.equal((await finish(collection)).outcome, "written");
  await collector.query("commit");
  const receipt = (await db.query("select p.created_at >= b.opened_at after_open, p.created_at > a.closed_at after_close, p.created_at > $3::timestamptz after_start, p.amount, p.tip from payments p join cash_shifts a on a.id=$1 join cash_shifts b on b.id=$2 where p.order_id=$4 or p.session_id=$5", [shiftA, shiftB, offlineAt, order, session])).rows;
  assert.equal(receipt.length, 1);
  assert.equal(receipt[0].after_open, true); assert.equal(receipt[0].after_close, true);
  assert.equal(receipt[0].after_start, true);
  assert.equal(Number(receipt[0].amount), 120); assert.equal(Number(receipt[0].tip), 20);
  assert.equal((await totals(shiftA)).expected, 0);
  assert.equal((await totals(shiftB)).expected, 120); // All cash, including staff tip.

  // Explicit offline receipt dates still belong to the historical shift.
  const offline = randomUUID();
  await db.query("insert into orders(id,restaurant_id,status,subtotal,total,currency) values($1,$2,'pending_payment',10,10,'MXN')", [offline, restaurant]);
  await db.query("select settle_offline_sale_v2($1,$2,'cash','probe',$3)", [restaurant, offline, offlineAt]);
  assert.equal((await totals(shiftA)).expected, 10);
  assert.equal((await totals(shiftB)).expected, 120);
  assert.equal(Number((await db.query("select expected_cash from cash_shifts where id=$1", [shiftA])).rows[0].expected_cash), 0);
  console.log("PASS F1: close/open/collection lock queue; tip stays in cash; explicit offline date preserved");

  // F2: a zero preflight, then a queue insert winning ahead of a waiting close.
  const preflight = await db.query("select count(*)::int n from offline_sale_queue where restaurant_id=$1 and approved_at is null and body->>'method'='cash'", [restaurant]);
  assert.equal(preflight.rows[0].n, 0);
  const ref = randomUUID();
  await db.query("begin");
  await db.query("select lock_restaurant_money($1)", [restaurant]);
  const closing = launch(opener, closeSql, [restaurant, shiftB, 120, ref]);
  await queued(openerPid);
  const held = await queue(db);
  await db.query("commit");
  assert.deepEqual(await finish(closing), { outcome: "held_cash", waiting: 1 });
  const untouched = (await db.query("select closed_at,expected_cash,counted_cash,close_ref,close_result from cash_shifts where id=$1", [shiftB])).rows[0];
  assert.ok(Object.values(untouched).every(v => v === null));
  // Approved cash, pending card and another tenant's cash cannot block it.
  await db.query("update offline_sale_queue set approved_at=clock_timestamp(),approved_by='probe' where pos_ref=$1", [held]);
  await queue(db, "card"); await queue(db, "cash", foreign);
  const closedB = await value(db, closeSql, [restaurant, shiftB, 120, ref]);
  assert.equal(closedB.expected, 120);
  await queue(db); // A later held receipt cannot change an already saved retry.
  assert.deepEqual(await value(db, closeSql, [restaurant, shiftB, 120, ref]), closedB);
  console.log("PASS F2: queue-before-close refuses without writes; same ref retries after review; scope exclusions and saved replay");

  // Reverse race: a queue writer waits for an already executing close.
  await db.query("update offline_sale_queue set approved_at=clock_timestamp(),approved_by='probe' where restaurant_id=$1 and body->>'method'='cash'", [restaurant]);
  const shiftC = await open(db);
  await db.query("begin");
  await db.query("select lock_restaurant_money($1)", [restaurant]);
  const laterRef = randomUUID();
  const laterBody = { posRef: laterRef, method: "cash", offline: { total: 100 } };
  const laterQueue = launch(opener, "select queue_offline_sale($1,$2,$3,'probe','MXN','probe','cash probe') value", [restaurant, laterRef, laterBody]);
  await queued(openerPid);
  assert.equal((await value(db, closeSql, [restaurant, shiftC, 0, randomUUID()])).expected, 0);
  await db.query("commit");
  assert.equal((await finish(laterQueue)).queued, true);
  assert.equal((await totals(shiftC)).expected, 0);
  console.log("PASS F2 reverse race: close-before-queue serializes; later held receipt is retained");
} finally {
  // Release locks and abort in-flight peer transactions before deleting fixtures.
  await Promise.allSettled(clients.map(client => client.query("rollback")));
  await Promise.allSettled(pending);
  try { await db.query("delete from restaurants where id = any($1::uuid[])", [restaurants]); }
  finally { await Promise.allSettled(clients.map(client => client.end())); }
}
