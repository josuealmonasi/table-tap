// Development SQL evidence for resolve_held_sale. Everything runs in one
// transaction that is rolled back: savepoints isolate each check, and the
// probe's restaurant, users and money never outlive the run.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

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
const db = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, statement_timeout: 10000 });
const restaurant = randomUUID();
const owner = `held-owner-${restaurant.slice(0, 8)}@probe.test`;
const waiter = `held-waiter-${restaurant.slice(0, 8)}@probe.test`;
const collector = "cashier@probe.test";
let shift;
const value = async (sql, args) => (await db.query(sql, args)).rows[0].value;
const totals = () => value("select cash_shift_totals($1,$2,clock_timestamp()) value", [restaurant, shift]);
const at = new Date(Date.now() - 86_400_000).toISOString();

async function held(amount, method = "cash") {
  const ref = randomUUID();
  const body = { posRef: ref, restaurantId: restaurant, method, currency: "MXN",
    items: [{ itemId: "bad", name: "Coffee", price: amount, qty: 1, mods: {} }],
    offline: { at, subtotal: amount, serviceFee: 0, tip: 0, discount: 0, total: amount } };
  await db.query(`insert into offline_sale_queue(restaurant_id,pos_ref,body,collector,currency,submitted_by,reason)
    values($1,$2,$3::jsonb,$4,'MXN',$4,'probe')`, [restaurant, ref, JSON.stringify(body), collector]);
  return ref;
}
const resolve = (ref, actor, disposition, amount, links = {}) => value(
  "select resolve_held_sale($1,$2,$3,$4,$5,$6,$7,'MXN',$8,$9,$10,$11) value",
  [restaurant, ref, actor, "Probe resolution reason", disposition, collector, amount, at,
    links.payment ?? null, links.receipt ?? null, links.payout ?? null]);
async function refused(run, message) {
  await db.query("savepoint refused");
  await assert.rejects(run, message);
  await db.query("rollback to savepoint refused");
}

async function check(name, run) {
  await db.query("savepoint held_check");
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    process.exitCode = 1;
    console.error(`FAIL ${name}: ${error.message.replaceAll("\n", " ")}`);
  } finally {
    await db.query("rollback to savepoint held_check");
    await db.query("release savepoint held_check");
  }
}

try {
  await db.connect();
  await db.query("begin");
  const ownerId = randomUUID(), waiterId = randomUUID();
  for (const [id, email] of [[ownerId, owner], [waiterId, waiter]]) {
    await db.query("insert into auth.users(id,email,aud,role) values($1,$2,'authenticated','authenticated')", [id, email]);
  }
  await db.query("insert into restaurants(id,name,plan,plan_status,currency,owner_id) values($1,'Held resolve probe','servicio','active','MXN',$2)", [restaurant, ownerId]);
  await db.query("insert into staff(restaurant_id,user_id,email,role) values($1,$2,$3,'waiter')", [restaurant, waiterId, waiter]);
  shift = await value("select open_cash_shift($1,'probe',100) value", [restaurant]);
  assert.ok(shift, "the isolated shift must open");

  await check("a waiter cannot resolve a held receipt", async () => {
    const ref = await held(50);
    await refused(resolve(ref, waiter, "no_cash", 0), /manager required/);
  });

  await check("retained cash enters the open drawer, not sales, and stops blocking the close", async () => {
    const before = await totals();
    const ref = await held(50);
    const waiting = () => value(`select count(*)::int value from offline_sale_queue where restaurant_id=$1
      and approved_at is null and resolved_at is null and body->>'method'='cash'`, [restaurant]);
    assert.equal(await waiting(), 1);
    const r = await resolve(ref, owner, "retained_cash", 50);
    assert.equal(r.disposition, "retained_cash");
    assert.ok(r.cash_receipt_id);
    const after = await totals();
    assert.equal(Number(after.unclassifiedCash), 50);
    assert.equal(Number(after.expected), Number(before.expected) + 50);
    assert.equal(Number(after.cashSales), Number(before.cashSales));
    assert.equal(await waiting(), 0);
    const closed = await value("select close_cash_shift($1,$2,150,'probe') value", [restaurant, shift]);
    assert.equal(Number(closed.expected), 150);
    assert.equal(Number(closed.difference), 0);
  });

  await check("the same request answers the same resolution; a different one is refused", async () => {
    const ref = await held(20);
    const first = await resolve(ref, owner, "retained_cash", 20);
    const again = await resolve(ref, owner, "retained_cash", 20);
    assert.equal(again.cash_receipt_id, first.cash_receipt_id);
    assert.equal(await value("select count(*)::int value from held_cash_receipts where pos_ref=$1", [ref]), 1);
    await refused(resolve(ref, owner, "no_cash", 0), /already resolved/);
  });

  await check("no_cash takes no amount", async () => {
    const ref = await held(10);
    await refused(resolve(ref, owner, "no_cash", 10), /no_cash takes no amount/);
  });

  await check("one payment backs one duplicate, never two", async () => {
    const payment = await value(`insert into payments(restaurant_id,amount,tip,method,actor_email,currency,created_at)
      values($1,30,0,'cash','probe','MXN',clock_timestamp()) returning id value`, [restaurant]);
    const a = await held(30), b = await held(30);
    const first = await resolve(a, owner, "duplicate", 30, { payment });
    assert.equal(first.payment_id, payment);
    await refused(resolve(b, owner, "duplicate", 30, { payment }), /held_resolution_duplicate_payment/);
  });

  await check("returned cash needs its recorded payout and nets to zero", async () => {
    const ref = await held(40);
    await refused(resolve(ref, owner, "returned_cash", 40), /matching recorded payout required/);
    const before = await totals();
    const payout = (await value("select create_cash_withdrawal($1,$2,40,'returned','probe') value", [restaurant, shift])).id;
    const r = await resolve(ref, owner, "returned_cash", 40, { payout });
    assert.equal(r.payout_id, payout);
    assert.equal(Number((await totals()).expected), Number(before.expected));
  });

  await check("a resolved receipt is frozen: no late approval, no edits", async () => {
    const ref = await held(15);
    await resolve(ref, owner, "retained_cash", 15);
    await refused(db.query("update offline_sale_queue set approved_at=clock_timestamp(),approved_by='late' where pos_ref=$1", [ref]), /immutable/);
    await refused(db.query("delete from offline_sale_queue where pos_ref=$1", [ref]), /immutable/);
    await refused(value(`select record_offline_sale($1,$2,'{}'::jsonb,'cash',$3,clock_timestamp(),null,'[]'::jsonb,$4,
      'Late approval reason',null,'manager_attested') value`, [restaurant, ref, collector, owner]), /resolved without a sale/);
  });

  await check("only the function can mark a receipt resolved, and nobody rewrites a held receipt", async () => {
    const ref = await held(12);
    await refused(db.query("update offline_sale_queue set resolved_at=clock_timestamp() where pos_ref=$1", [ref]), /audited resolution required/);
    await refused(db.query("update offline_sale_queue set body=body||'{\"note\":\"x\"}' where pos_ref=$1", [ref]), /immutable/);
  });

  await check("a card receipt is not resolved here", async () => {
    const ref = await held(25, "card");
    await refused(resolve(ref, owner, "no_cash", 0), /held cash receipt required/);
  });

  await check("deleting the restaurant still takes its resolved receipts with it", async () => {
    const ref = await held(18);
    await resolve(ref, owner, "retained_cash", 18);
    await db.query("delete from restaurants where id=$1", [restaurant]);
    assert.equal(await value("select count(*)::int value from held_sale_resolutions where restaurant_id=$1", [restaurant]), 0);
    assert.equal(await value("select count(*)::int value from held_cash_receipts where restaurant_id=$1", [restaurant]), 0);
  });
} finally {
  try { await db.query("rollback"); } finally { await db.end(); }
}
