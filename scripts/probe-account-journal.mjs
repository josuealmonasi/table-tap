// Development SQL evidence only, after schema application. Never run in production.
import assert from "node:assert/strict";
import { probeLiveJournal, debtMatches } from "./account-journal-live-probe.mjs";
import { probeDeferredJournal } from "./account-journal-deferred-probe.mjs";
import { probeJournalArchive } from "./account-journal-archive-probe.mjs";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { account, order, settle, fixture, opening, movement, refused, queued, backfill } from "./account-journal-probe-fixtures.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(path.join(repo, ".env.development.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const connectionString = process.env.DATABASE_URL ?? "";
if (process.argv.includes("--prod") || !url || !connectionString
  || `${url} ${connectionString}`.includes("vayymkzrvlepoksualku") || process.env.NODE_ENV === "production") {
  throw new Error("refusing to probe production or an unknown database");
}
const project = new URL(url).hostname.split(".")[0];
if (!connectionString.includes(project)) throw new Error("development project and SQL connection differ");
const config = { connectionString, ssl: { rejectUnauthorized: false }, statement_timeout: 10000 };
const db = new pg.Client(config), peer = new pg.Client(config);
const restaurant = randomUUID(), foreign = randomUUID();
let pending;

async function probeTimings() {
  const owner = await account(db, restaurant);
  const { rows: orders } = await db.query(`insert into orders(restaurant_id,status,subtotal,total,currency)
    select $1,'completed',1,1,'MXN' from generate_series(1,500) returning id`, [restaurant]);
  // Keep 450 settled charges as history and exactly 50 orders outstanding.
  const charge = async ids => {
    const { rows } = await db.query("select account_charge_v2($1,$2,$3,$4,'probe') value", [restaurant, owner, ids, ids.length]);
    assert.equal(rows[0].value.outcome, "charged");
  };
  await charge(orders.slice(0, 450).map(row => row.id));
  await settle(db, restaurant, owner, 450);
  await charge(orders.slice(450).map(row => row.id));
  assert.equal((await db.query("select count(*)::int n from account_movements where account_id=$1 and kind='charge'", [owner])).rows[0].n, 500);
  assert.equal((await db.query("select count(*)::int n from orders where account_id=$1 and not paid and not written_off and status<>'cancelled'", [owner])).rows[0].n, 50);
  await db.query("begin");
  await settle(db, restaurant, owner, 50);
  const commitStart = performance.now();
  await db.query("commit");
  console.log(`TIMING: settle 50 orders on an account with 500 charges: COMMIT ${(performance.now() - commitStart).toFixed(2)} ms`);
  assert.equal((await db.query("select count(*)::int n from orders where account_id=$1 and paid", [owner])).rows[0].n, 500);
  await debtMatches(db, owner);

  const { rows: kitchen } = await db.query(`insert into orders(restaurant_id,status,subtotal,total,currency)
    select $1,'preparing',1,1,'MXN' from generate_series(1,200) returning id`, [restaurant]);
  // Each update is its own transaction, including the COMMIT in this total.
  const statusStart = performance.now();
  for (const row of kitchen) {
    const result = await db.query("update orders set status='ready' where id=$1 and account_id is null", [row.id]);
    assert.equal(result.rowCount, 1);
  }
  console.log(`TIMING: 200 status updates on non-account orders: total ${(performance.now() - statusStart).toFixed(2)} ms`);
}

try {
  await db.connect(); await peer.connect();
  const peerPid = (await peer.query("select pg_backend_pid() pid")).rows[0].pid;
  await db.query("insert into restaurants(id,name,plan,plan_status,currency,account_journal_started_at) values($1,'Journal probe','servicio','active','MXN',null),($2,'Foreign journal probe','servicio','active','MXN',null)", [restaurant, foreign]);
  const f = await fixture(db, restaurant), stranger = await account(db, foreign);
  const foreignOrder = await order(db, foreign, stranger, 10);
  assert.equal((await db.query("select journal_started_at from customer_accounts where id=$1", [f.owner])).rows[0].journal_started_at, null);
  const expected = await opening(db, restaurant, f.owner);
  assert.deepEqual(expected, { MXN: "10700", USD: "1300" });
  await db.query("begin");
  await db.query("set local role service_role");
  const report = await backfill(db, restaurant);
  await db.query("commit");
  assert.deepEqual(Object.fromEntries(report.map(row => [row.currency, row.opening_debt_cents])), expected);
  assert.equal(report.find(row => row.currency === "MXN").observation_count, "2");
  assert.equal(report.find(row => row.currency === "MXN").collection_count, "1");
  const { rows: events } = await db.query("select * from account_movements where account_id=$1 order by id", [f.owner]);
  assert.equal(events.length, 5);
  const debt = events.find(row => row.kind === "opening" && row.currency === "MXN");
  assert.equal(debt.tip_cents, "1000"); assert.equal(debt.service_cents, "670");
  const partial = events.find(row => row.adjustment_id && row.order_id === f.partial);
  assert.equal(partial.tip_cents, "0"); assert.equal(partial.service_cents, "330");
  assert(events.every(row => row.provenance === "backfill"));
  assert(events.filter(row => row.kind !== "opening").every(row => row.debt_delta_cents === "0"));
  const unknown = events.find(row => row.kind === "opening" && row.currency === "MXN")
    .charge_snapshot.orders.find(row => row.order_id === f.unknown);
  assert.equal(unknown.charged_at, null); assert.equal(unknown.original_total, null);
  assert.equal(unknown.charge_date_known, false);
  assert.equal(events.find(row => row.kind === "historical_observation").charge_snapshot.adjustment.kind, "account_credit");
  const history = events.find(row => row.kind === "collection");
  assert.equal(history.tip_cents, "500");
  assert.equal(history.amount_cents, "4500"); assert.equal(history.charge_snapshot.payment.account_id, f.owner);
  const started = (await db.query("select journal_started_at from customer_accounts where id=$1", [f.owner])).rows[0];
  await db.query("begin");
  assert.deepEqual((await db.query("select * from account_journal_backfill_v1($1,$2)", [restaurant, started.journal_started_at])).rows, []);
  await db.query("commit");
  assert.deepEqual((await db.query("select * from account_movements where account_id=$1 order by id", [f.owner])).rows, events);
  assert.deepEqual((await db.query("select journal_started_at from customer_accounts where id=$1", [f.owner])).rows[0], started);

  // Owner connection reaches the guard; service_role separately has no UPDATE/DELETE privilege.
  await refused(db, () => db.query("update account_movements set reason='changed' where account_id=$1", [f.owner]), /immutable/);
  await refused(db, () => db.query("delete from account_movements where account_id=$1", [f.owner]), /immutable/);
  await refused(db, () => movement(db, restaurant, f.owner, f.partial, { debt_delta_cents: -1 }), /account_movements_debt/);
  await refused(db, () => movement(db, restaurant, f.owner, null), /account_movements_source/);
  await refused(db, () => movement(db, restaurant, f.owner, foreignOrder), /order differs/);
  await refused(db, () => movement(db, restaurant, stranger, foreignOrder), /account differs/);
  await refused(db, () => movement(db, restaurant, f.owner, f.partial, { currency: "USD" }), /order differs/);
  await refused(db, () => movement(db, restaurant, f.owner, f.full, { kind: "credit",
    adjustment_id: partial.adjustment_id, debt_delta_cents: -1 }), /adjustment differs/);
  await refused(db, () => movement(db, restaurant, f.owner, null, { kind: "credit",
    debt_delta_cents: -1 }), /account_movements_source/);
  await refused(db, () => movement(db, restaurant, f.owner, null, { kind: "collection",
    debt_delta_cents: -1 }), /account_movements_source/);
  await refused(db, () => movement(db, restaurant, f.owner, null, { kind: "refund_paid",
    debt_delta_cents: 0 }), /account_movements_source/);
  await refused(db, () => movement(db, restaurant, f.owner, null, { kind: "collection",
    payment_id: history.payment_id, currency: "USD", debt_delta_cents: -1 }), /payment differs/);
  await refused(db, () => movement(db, restaurant, f.owner, null, { kind: "collection", provenance: "backfill",
    debt_delta_cents: 0, payment_id: history.payment_id }), /cannot import more history/);
  const privileges = (await db.query(`select
    has_table_privilege('service_role','account_movements','SELECT') and has_table_privilege('service_role','account_movements','INSERT') allowed,
    has_table_privilege('service_role','account_movements','UPDATE,DELETE,TRUNCATE') mutates,
    has_table_privilege('anon','account_movements','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_access,
    has_table_privilege('authenticated','account_movements','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') client_access,
    has_function_privilege('anon','account_journal_backfill_v1(uuid,timestamptz)','EXECUTE') anon_execute,
    has_function_privilege('authenticated','account_journal_backfill_v1(uuid,timestamptz)','EXECUTE') client_execute,
    has_function_privilege('service_role','account_journal_backfill_v1(uuid,timestamptz)','EXECUTE') service_execute`)).rows[0];
  assert.deepEqual(privileges, { allowed: true, mutates: false, anon_access: false, client_access: false,
    anon_execute: false, client_execute: false, service_execute: true });
  assert.equal((await db.query("select relrowsecurity from pg_class where oid='account_movements'::regclass")).rows[0].relrowsecurity, true);
  assert.equal((await db.query("select count(*)::int n from pg_policies where tablename='account_movements'")).rows[0].n, 0);

  // Exercise effective roles as well as the ACL catalog. Roll back every probe.
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const sql of ["update account_movements set reason='changed'", "delete from account_movements", "truncate account_movements"]) {
      await refused(db, async () => { await db.query(`set local role ${role}`); await db.query(sql); }, /permission denied/);
    }
    if (role === "service_role") continue;
    for (const sql of ["select * from account_movements", "select * from account_journal_backfill_v1($1,clock_timestamp())"]) {
      await refused(db, async () => { await db.query(`set local role ${role}`);
        await db.query(sql, sql.includes("$1") ? [restaurant] : []); }, /permission denied/);
    }
    await refused(db, async () => { await db.query(`set local role ${role}`);
      await movement(db, restaurant, f.owner, f.partial); }, /permission denied/);
  }
  await db.query("begin"); await db.query("set local role service_role");
  await movement(db, restaurant, f.owner, f.partial);
  assert.equal((await db.query("select count(*)::int n from account_movements where kind='charge' and order_id=$1", [f.partial])).rows[0].n, 1);
  await db.query("savepoint replay");
  await assert.rejects(() => movement(db, restaurant, f.owner, f.partial), /account_movements_charge_once/);
  await db.query("rollback to savepoint replay");
  await db.query("rollback");

  // Test the FUNCTION's lock directly: the peer does not pre-acquire it.
  // Roll back this deliberately pre-lock cutoff; real activation chooses it
  // after acquiring the lock, as the serialization tests below do.
  const untouched = await account(db, restaurant);
  await db.query("begin"); await db.query("select lock_restaurant_money($1)", [restaurant]);
  pending = (async () => {
    await peer.query("begin");
    await peer.query("select * from account_journal_backfill_v1($1,clock_timestamp())", [restaurant]);
    await peer.query("rollback");
  })().then(() => ({}), error => ({ error }));
  await queued(db, peerPid);
  await db.query("commit");
  const direct = await pending; pending = null;
  if (direct.error) throw direct.error;
  assert.equal((await db.query("select journal_started_at from customer_accounts where id=$1", [untouched])).rows[0].journal_started_at, null);
  assert.equal((await db.query("select count(*)::int n from account_movements where account_id=$1", [untouched])).rows[0].n, 0);

  // Both serializations: a waiting backfill sees the winning settlement;
  // a waiting settlement sees the opening snapshot taken before it.
  for (const winner of ["settle", "backfill"]) {
    const owner = await account(db, restaurant);
    await order(db, restaurant, owner, 25);
    await db.query("begin"); await db.query("select lock_restaurant_money($1)", [restaurant]);
    pending = (async () => {
      await peer.query("begin");
      let rows;
      if (winner === "settle") rows = await backfill(peer, restaurant);
      else await settle(peer, restaurant, owner, 25);
      await peer.query("commit"); return rows;
    })().then(result => ({ result }), error => ({ error }));
    await queued(db, peerPid);
    if (winner === "settle") await settle(db, restaurant, owner, 25);
    else await backfill(db, restaurant);
    await db.query("commit");
    const finished = await pending; pending = null;
    if (finished.error) throw finished.error;
    const snapshot = (await db.query("select debt_delta_cents from account_movements where account_id=$1 and currency='MXN' and kind='opening'", [owner])).rows[0];
    assert.equal(snapshot.debt_delta_cents, winner === "settle" ? "0" : "2500");
    assert.equal((await db.query("select count(*)::int n from payments where account_id=$1", [owner])).rows[0].n, 1);
    assert.equal((await db.query("select bool_and(paid) paid from orders where account_id=$1", [owner])).rows[0].paid, true);
    await debtMatches(db, owner);
  }
  await probeLiveJournal(db, peer, restaurant, peerPid, f.owner);
  await probeDeferredJournal(db, restaurant, await account(db, restaurant));
  await probeJournalArchive(db);
  await probeTimings();
  await db.query("delete from restaurants where id=$1", [restaurant]);
  assert.equal((await db.query("select count(*)::int n from account_movements where restaurant_id=$1", [restaurant])).rows[0].n, 0);
  console.log("PASS: opening per currency, evidenced history, no invented charge date, replay, guards, constraints, effective roles, tenant/currency isolation, function money lock, both settlement races, restaurant cascade");
} finally {
  await db.query("rollback").catch(() => {});
  if (pending) await pending;
  await peer.query("rollback").catch(() => {});
  try { await db.query("delete from restaurants where id = any($1::uuid[])", [[restaurant, foreign]]); }
  finally { await Promise.allSettled([db.end(), peer.end()]); }
}
