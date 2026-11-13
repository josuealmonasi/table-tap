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
const db = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, statement_timeout: 10000, connectionTimeoutMillis: 10000 });
const restaurant = randomUUID();
const owner = `held-owner-${restaurant.slice(0, 8)}@probe.test`;
const waiter = `held-waiter-${restaurant.slice(0, 8)}@probe.test`;
const collector = "cashier@probe.test";
let shift;
let item;
let transactionStarted = false;
const value = async (sql, args) => (await db.query(sql, args)).rows[0].value;
const totalsOf = id => value("select cash_shift_totals($1,$2,clock_timestamp()) value", [restaurant, id]);
const totals = () => totalsOf(shift);
// A day before any probe shift opened: no shift covers it, so retained cash
// falls back to the open drawer.
const at = new Date(Date.now() - 86_400_000).toISOString();

async function held(amount, method = "cash", currency = "MXN", when = at) {
  const ref = randomUUID();
  const body = { posRef: ref, restaurantId: restaurant, method, currency,
    items: [{ itemId: item, name: "Coffee", price: amount, qty: 1, mods: {} }],
    offline: { at: when, subtotal: amount, serviceFee: 0, tip: 0, discount: 0, total: amount } };
  await db.query(`insert into offline_sale_queue(restaurant_id,pos_ref,body,collector,currency,submitted_by,reason)
    values($1,$2,$3::jsonb,$4,$5,$4,'probe')`, [restaurant, ref, JSON.stringify(body), collector, currency]);
  return ref;
}
const accounting = () => value(`select jsonb_build_object(
  'orders', (select count(*) from orders where restaurant_id=$1),
  'payments', (select count(*) from payments where restaurant_id=$1),
  'stock', (select jsonb_agg(jsonb_build_array(id,stock,available) order by id) from menu_items where restaurant_id=$1)) value`, [restaurant]);
async function resolve(ref, actor, disposition, amount, links = {}, currency = "MXN", collectedAt = at) {
  const before = await accounting();
  const result = await value(
  "select resolve_held_sale($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value",
  [restaurant, ref, actor, "Probe resolution reason", disposition, collector, amount, currency, collectedAt,
    links.payment ?? null, links.receipt ?? null, links.payout ?? null]);
  assert.deepEqual(await accounting(), before, "resolution must not create orders/payments or change stock");
  return result;
}
async function refused(run, message) {
  await db.query("savepoint refused");
  try { await assert.rejects(run, message); }
  finally {
    await db.query("rollback to savepoint refused");
    await db.query("release savepoint refused");
  }
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
  transactionStarted = true;
  const ownerId = randomUUID(), waiterId = randomUUID();
  for (const [id, email] of [[ownerId, owner], [waiterId, waiter]]) {
    await db.query("insert into auth.users(id,email,aud,role) values($1,$2,'authenticated','authenticated')", [id, email]);
  }
  await db.query("insert into restaurants(id,name,plan,plan_status,currency,owner_id) values($1,'Held resolve probe','servicio','active','MXN',$2)", [restaurant, ownerId]);
  await db.query("insert into staff(restaurant_id,user_id,email,role) values($1,$2,$3,'waiter')", [restaurant, waiterId, waiter]);
  shift = await value("select open_cash_shift($1,'probe',100) value", [restaurant]);
  assert.ok(shift, "the isolated shift must open");
  item = await value(`insert into menu_items(restaurant_id,name,price,stock) values($1,'Probe coffee',50,10) returning id value`, [restaurant]);

  await check("a waiter cannot resolve a held receipt", async () => {
    const ref = await held(50);
    await refused(() => resolve(ref, waiter, "no_cash", 0), /manager required/);
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
    assert.equal(await value("select shift_id value from held_cash_receipts where id=$1", [r.cash_receipt_id]), shift,
      "a collection no shift covers falls back to the open drawer");
    const after = await totals();
    assert.equal(Number(after.unclassifiedCash), 50);
    assert.equal(Number(after.unclassifiedCashByCurrency.MXN), 50);
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
    await refused(() => resolve(ref, owner, "no_cash", 0), /already resolved/);
  });

  await check("no_cash takes no amount", async () => {
    const ref = await held(10);
    await refused(() => resolve(ref, owner, "no_cash", 10), /no_cash takes no amount/);
  });

  await check("one payment backs one duplicate, never two", async () => {
    const payment = await value(`insert into payments(restaurant_id,amount,tip,method,actor_email,currency,created_at)
      values($1,30,0,'cash','probe','MXN',clock_timestamp()) returning id value`, [restaurant]);
    const a = await held(30), b = await held(30);
    const first = await resolve(a, owner, "duplicate", 30, { payment });
    assert.equal(first.payment_id, payment);
    await refused(() => resolve(b, owner, "duplicate", 30, { payment }), /held_resolution_duplicate_payment/);
  });

  await check("a duplicate can reference a retained cash receipt without counting it twice", async () => {
    const retained = await resolve(await held(30), owner, "retained_cash", 30);
    const before = await totals();
    const duplicate = await resolve(await held(30), owner, "duplicate", 30, { receipt: retained.cash_receipt_id });
    assert.equal(duplicate.cash_receipt_id, retained.cash_receipt_id);
    assert.deepEqual(await totals(), before);
    assert.equal(await value("select count(*)::int value from held_cash_receipts where restaurant_id=$1", [restaurant]), 1);
  });

  await check("foreign retained cash is disclosed by currency and stays outside expected", async () => {
    const before = await totals();
    await resolve(await held(25, "cash", "USD"), owner, "retained_cash", 25, {}, "USD");
    const after = await totals();
    assert.equal(Number(after.unclassifiedCashByCurrency.USD), 25);
    assert.equal(Number(after.unclassifiedCash), Number(before.unclassifiedCash));
    assert.equal(Number(after.expected), Number(before.expected));
    assert.equal(Number(after.cashSales), Number(before.cashSales));
  });

  await check("foreign returned cash takes no payout or receipt", async () => {
    const ref = await held(40, "cash", "USD");
    const before = await totals();
    const payout = (await value("select create_cash_withdrawal($1,$2,40,'returned','probe','other') value", [restaurant, shift])).id;
    await refused(() => resolve(ref, owner, "returned_cash", 40, { payout }, "USD"), /foreign returned cash takes no payout/);
    // Remove the unrelated drawer payout before checking the net change.
    await value("select delete_cash_withdrawal($1,$2,$3) value", [restaurant, shift, payout]);
    const result = await resolve(ref, owner, "returned_cash", 40, {}, "USD");
    assert.equal(result.payout_id, null);
    assert.equal(result.cash_receipt_id, null);
    assert.deepEqual(await totals(), before);
    assert.equal(await value("select count(*)::int value from held_cash_receipts where pos_ref=$1", [ref]), 0);
  });

  await check("a resolution cannot link another restaurant's payment or withdrawal", async () => {
    const other = randomUUID();
    await db.query("insert into restaurants(id,name,plan,plan_status,currency,owner_id) values($1,'Other probe','servicio','active','MXN',$2)", [other, ownerId]);
    const otherShift = await value("select open_cash_shift($1,'probe',100) value", [other]);
    const payment = await value(`insert into payments(restaurant_id,amount,tip,method,actor_email,currency)
      values($1,30,0,'cash','probe','MXN') returning id value`, [other]);
    const payout = (await value("select create_cash_withdrawal($1,$2,30,'returned','probe','other') value", [other, otherShift])).id;
    const ref = await held(30);
    await refused(() => resolve(ref, owner, "duplicate", 30, { payment }), /matching cash payment required/);
    await refused(() => resolve(ref, owner, "returned_cash", 30, { payout }), /matching recorded payout required/);
  });

  await check("returned cash needs its recorded payout and nets to zero", async () => {
    const ref = await held(40);
    await refused(() => resolve(ref, owner, "returned_cash", 40), /matching recorded payout required/);
    const before = await totals();
    const payout = (await value("select create_cash_withdrawal($1,$2,40,'returned','probe','other') value", [restaurant, shift])).id;
    const r = await resolve(ref, owner, "returned_cash", 40, { payout });
    assert.equal(r.payout_id, payout);
    const deletion = await value("select delete_cash_withdrawal($1,$2,$3) value", [restaurant, shift, payout]);
    assert.deepEqual(deletion, { outcome: "linked" });
    assert.equal(await value("select count(*)::int value from cash_movements where id=$1", [payout]), 1);
    assert.equal(Number((await totals()).expected), Number(before.expected));
  });

  await check("returned cash cannot be backed by a tips payout (full review M2)", async () => {
    const ref = await held(45);
    const tips = (await value("select create_cash_withdrawal($1,$2,45,'tips','probe','tips') value", [restaurant, shift])).id;
    await refused(() => resolve(ref, owner, "returned_cash", 45, { payout: tips }), /matching recorded payout required/);
    const other = (await value("select create_cash_withdrawal($1,$2,45,'returned','probe','other') value", [restaurant, shift])).id;
    assert.equal((await resolve(ref, owner, "returned_cash", 45, { payout: other })).payout_id, other);
  });

  await check("retained and approved held cash both count in the shift that collected it, even once closed (full review M1)", async () => {
    const shiftA = shift;
    const collectedAt = await value("select clock_timestamp() value");
    // Shift A closes with the offline sale's MX$60 already in its drawer: 60 over.
    const openA = await totalsOf(shiftA);
    const closedA = await value("select close_cash_shift($1,$2,$3,'probe') value", [restaurant, shiftA, Number(openA.expected) + 60]);
    assert.equal(Number(closedA.difference), 60);
    // The till queues the receipt only after A closed; shift B is open when it is decided.
    const ref = await held(60, "cash", "MXN", collectedAt.toISOString());
    const shiftB = await value("select open_cash_shift($1,'probe',100) value", [restaurant]);
    assert.ok(shiftB, "shift B must open");
    const dayStart = await value("select clock_timestamp() value");
    const listed = async () => value("select count(*)::int value from cash_shifts_for_day($1,$2) where id=$3", [restaurant, dayStart, shiftA]);
    assert.equal(await listed(), 0);
    const baseA = await totalsOf(shiftA), baseB = await totalsOf(shiftB);
    const moved = async () => {
      const a = await totalsOf(shiftA), b = await totalsOf(shiftB);
      return { a: Number(a.expected) - Number(baseA.expected), b: Number(b.expected) - Number(baseB.expected) };
    };

    await db.query("savepoint decision");
    const r = await resolve(ref, owner, "retained_cash", 60, {}, "MXN", collectedAt);
    assert.equal(await value("select shift_id value from held_cash_receipts where id=$1", [r.cash_receipt_id]), shiftA);
    const retained = await moved();
    assert.equal(await listed(), 1, "the corrected closed shift shows in today's handover");
    await db.query("rollback to savepoint decision");

    const order = { subtotal: 60, service_fee: 0, tip: 0, discount: 0, total: 60, tax_pct: 0, currency: "MXN",
      items: [{ itemId: item, name: "Coffee", price: 60, qty: 1, mods: {} }], note: null, customer_name: null,
      offline_drift: null, preparation_pending: false, ticket_email_skip: false };
    const ticket = await value(`select record_offline_sale($1,$2,$3::jsonb,'cash',$4,$5,null,'[]'::jsonb,$6,
      'Approved late probe receipt',null,'manager_attested') value`, [restaurant, ref, JSON.stringify(order), collector, collectedAt, owner]);
    assert.equal(ticket.outcome, "settled");
    const approved = await moved();
    await db.query("release savepoint decision");

    assert.deepEqual(retained, { a: 60, b: 0 });
    assert.deepEqual(approved, retained, "both decisions must land in the same shift");
  });

  await check("returned cash is received in the shift that collected it and paid out from the open one (full review M1)", async () => {
    const shiftA = shift;
    const collectedAt = await value("select clock_timestamp() value");
    // Shift A closes with the offline sale's MX$60 still in its drawer: 60 over.
    const openA = await totalsOf(shiftA);
    const counted = Number(openA.expected) + 60;
    const closedA = await value("select close_cash_shift($1,$2,$3,'probe') value", [restaurant, shiftA, counted]);
    assert.equal(Number(closedA.difference), 60);
    const ref = await held(60, "cash", "MXN", collectedAt.toISOString());
    const shiftB = await value("select open_cash_shift($1,'probe',100) value", [restaurant]);
    assert.ok(shiftB, "shift B must open");
    const dayStart = await value("select clock_timestamp() value");
    const baseB = await totalsOf(shiftB);
    // During B the MX$60 is handed back out of the drawer, recorded as B's withdrawal.
    const payout = (await value("select create_cash_withdrawal($1,$2,60,'returned','probe','other') value", [restaurant, shiftB])).id;
    const r = await resolve(ref, owner, "returned_cash", 60, { payout }, "MXN", collectedAt);
    assert.equal(r.payout_id, payout);
    assert.equal(await value("select shift_id value from held_cash_receipts where id=$1", [r.cash_receipt_id]), shiftA);
    // A explains its count: the +60 it received; B explains its own: the -60 paid out.
    const a = await totalsOf(shiftA), b = await totalsOf(shiftB);
    assert.equal(Number(a.expected), counted, "A's overage is explained by the receipt");
    assert.equal(Number(a.unclassifiedCash) - Number(openA.unclassifiedCash), 60);
    assert.equal(Number(b.expected), Number(baseB.expected) - 60, "B expects the cash that physically left");
    assert.equal(Number(b.withdrawn) - Number(baseB.withdrawn), 60);
    assert.equal(Number(b.unclassifiedCash), Number(baseB.unclassifiedCash));
    const closedB = await value("select close_cash_shift($1,$2,$3,'probe') value", [restaurant, shiftB, Number(baseB.expected) - 60]);
    assert.equal(Number(closedB.difference), 0);
    assert.equal(await value("select count(*)::int value from cash_shifts_for_day($1,$2) where id=$3", [restaurant, dayStart, shiftA]), 1,
      "the corrected closed shift shows in today's handover");
  });

  await check("a resolved receipt is frozen: no late approval, no edits", async () => {
    const ref = await held(15);
    await resolve(ref, owner, "retained_cash", 15);
    await refused(() => db.query("update offline_sale_queue set approved_at=clock_timestamp(),approved_by='late' where pos_ref=$1", [ref]), /immutable/);
    await refused(() => db.query("delete from offline_sale_queue where pos_ref=$1", [ref]), /immutable/);
    await refused(() => value(`select record_offline_sale($1,$2,'{}'::jsonb,'cash',$3,clock_timestamp(),null,'[]'::jsonb,$4,
      'Late approval reason',null,'manager_attested') value`, [restaurant, ref, collector, owner]), /resolved without a sale/);
  });

  await check("only the function can mark a receipt resolved, and nobody rewrites a held receipt", async () => {
    const ref = await held(12);
    await refused(() => db.query("update offline_sale_queue set resolved_at=clock_timestamp() where pos_ref=$1", [ref]), /audited resolution required/);
    await refused(() => db.query("update offline_sale_queue set body=body||'{\"note\":\"x\"}' where pos_ref=$1", [ref]), /immutable/);
  });

  await check("a card receipt is not resolved here", async () => {
    const ref = await held(25, "card");
    await refused(() => resolve(ref, owner, "no_cash", 0), /held cash receipt required/);
  });

  await check("deleting the restaurant still takes its resolved receipts with it", async () => {
    const ref = await held(18);
    await resolve(ref, owner, "retained_cash", 18);
    await db.query("delete from restaurants where id=$1", [restaurant]);
    assert.equal(await value("select count(*)::int value from held_sale_resolutions where restaurant_id=$1", [restaurant]), 0);
    assert.equal(await value("select count(*)::int value from held_cash_receipts where restaurant_id=$1", [restaurant]), 0);
  });
} finally {
  try { if (transactionStarted) await db.query("rollback"); } finally { await db.end(); }
}
