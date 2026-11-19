import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { account, order } from "./account-journal-probe-fixtures.mjs";

// Attacks and function replacements roll back; the real-COMMIT kitchen
// control owns a separate restaurant and deletes it in finally.
export async function probeDeferredJournal(db, restaurant, owner) {
  const definition = async name => (await db.query("select pg_get_functiondef($1::regprocedure) sql", [name])).rows[0].sql;
  const original = await definition("assert_account_journal_v1(uuid)");
  const check = await definition("check_account_journal_v1()");
  const guard = "and not (v_account = any(v_checked))";
  assert(check.includes(guard), "the per-account cache guard must exist");
  const counted = original.replace(/\bbegin\b/i, `begin
    if p_account is not null then
      perform set_config('tabletap.journal_probe_assert_calls',
        (current_setting('tabletap.journal_probe_assert_calls')::int + 1)::text, true);
      if current_setting('tabletap.journal_probe_assert_calls')::int > 1 then
        raise exception 'planted second account assert';
      end if;
    end if;`);
  assert.notEqual(counted, original);
  for (const planted of [false, true]) {
    const ids = [randomUUID(), randomUUID()];
    await db.query("begin");
    try {
      await db.query(counted);
      if (planted) await db.query(check.replace(guard, ""));
      await db.query("select set_config('tabletap.journal_probe_assert_calls','0',true)");
      await db.query(`insert into orders(id,restaurant_id,status,subtotal,total,currency)
        select unnest($1::uuid[]),$2,'completed',1,1,'MXN'`, [ids, restaurant]);
      const { rows } = await db.query("select account_charge_v2($1,$2,$3,2,'probe') value", [restaurant, owner, ids]);
      assert.equal(rows[0].value.outcome, "charged");
      assert.equal((await db.query(`select count(*)::int n from account_movements
        where account_id=$1 and order_id=any($2::uuid[]) and kind='charge'`, [owner, ids])).rows[0].n, 2);
      if (planted) await assert.rejects(() => db.query("set constraints all immediate"), /planted second account assert/);
      else {
        await db.query("set constraints all immediate");
        assert.equal((await db.query("select current_setting('tabletap.journal_probe_assert_calls') n")).rows[0].n, "1");
      }
    } finally { await db.query("rollback"); }
    assert.equal((await db.query("select count(*)::int n from orders where id=any($1::uuid[])", [ids])).rows[0].n, 0);
  }
  await probeNonMoneyUpdates(db, restaurant, owner, check);
  const cases = [
    ["immediate-mode total attack", () => probeOrderAttack(db, restaurant, owner, false)],
    ["three-step charged order ID swap", () => probeOrderAttack(db, restaurant, owner, true)],
    ["late deferred allocation catches a planted mismatch at COMMIT", () => probeLateWriter(db, restaurant, owner, original, definition)],
    ["ordinary charged kitchen status move commits", () => probeKitchenCommit(db)],
  ];
  for (const [label, probe] of cases) {
    try { await probe(); console.log(`ok: ${label}`); }
    catch (error) { console.error(`FAIL: ${label}: ${error.message}`); process.exitCode = 1; throw error; }
  }
  assert.equal(await definition("assert_account_journal_v1(uuid)"), original);
  assert.equal(await definition("check_account_journal_v1()"), check);
  console.log("PASS: two source rows assert once; removing the cache guard hits the planted second-call failure (rolled back)");
}

async function chargedOrders(db, restaurant, owner) {
  const started = (await db.query("select journal_started_at from customer_accounts where id=$1", [owner])).rows[0];
  assert(started?.journal_started_at, "fixture account must have a started journal");
  const ids = [await order(db, restaurant, owner, 1), await order(db, restaurant, owner, 2)];
  assert.equal((await db.query(`select count(*)::int n from orders
    where id=any($1::uuid[]) and account_id=$2 and charged_at is not null`, [ids, owner])).rows[0].n, 2);
  return ids;
}

async function probeOrderAttack(db, restaurant, owner, swap) {
  let ids;
  await db.query("begin");
  try {
    ids = await chargedOrders(db, restaurant, owner);
    // Do not let setup events reconcile swapped sources before the ID guard.
    await db.query("set constraints all immediate");
    await db.query("set constraints all deferred");
    await db.query("savepoint journal_attack");
    if (swap) {
      // Leave FK and journal events deferred until both original IDs exist again.
      const temporary = randomUUID();
      for (const [from, to] of [[ids[0], temporary], [ids[1], ids[0]], [temporary, ids[1]]]) {
        assert.equal((await db.query("update orders set id=$2 where id=$1", [from, to])).rowCount, 1);
      }
      await assert.rejects(() => db.query("set constraints all immediate"), /started account charge identity is immutable/);
    } else {
      assert.equal((await db.query("update customer_accounts set name=name where id=$1", [owner])).rowCount, 1);
      await db.query("set constraints all immediate");
      assert.equal((await db.query("select $1::uuid=any(current_setting('tabletap.journal_checked')::uuid[]) checked", [owner])).rows[0].checked, true);
      await assert.rejects(() => db.query("update orders set total=total+1 where id=$1", [ids[0]]), /account journal source mismatch/);
    }
    await db.query("rollback to savepoint journal_attack");
    assert.deepEqual((await db.query("select id,total::float8 from orders where id=any($1::uuid[]) order by total", [ids])).rows,
      [{ id: ids[0], total: 1 }, { id: ids[1], total: 2 }]);
  } finally { await db.query("rollback"); }
  assert.equal((await db.query("select count(*)::int n from orders where id=any($1::uuid[])", [ids])).rows[0].n, 0);
}

async function probeLateWriter(db, restaurant, owner, original, definition) {
  const finish = await definition("finish_payment_allocation()");
  const marked = finish.replace(/return null;/i,
    "perform set_config('tabletap.journal_probe_allocation_finished','yes',true); return null;");
  const observed = original.replace(/\bbegin\b/i, `begin
    if current_setting('tabletap.journal_probe_require_allocation',true) = 'yes'
      and current_setting('tabletap.journal_probe_allocation_finished',true) is distinct from 'yes' then
      raise exception 'journal probe checked before deferred allocation';
    end if;`);
  assert.notEqual(marked, finish); assert.notEqual(observed, original);
  const payment = randomUUID();
  let committed = false;
  await db.query("begin");
  try {
    await db.query(marked); await db.query(observed);
    const [id, mismatch] = await chargedOrders(db, restaurant, owner);
    await db.query("update customer_accounts set name=name where id=$1", [owner]);
    await db.query("set constraints all immediate");
    await db.query("set constraints all deferred");
    await db.query("select set_config('tabletap.allocation_writer','v1',true)");
    await db.query(`insert into payments(id,restaurant_id,account_id,order_id,amount,tip,method,actor_email)
      values($1,$2,$3,$4,1,0,'cash','probe')`, [payment, restaurant, owner, id]);
    await db.query("update orders set paid=true where id=$1", [id]);
    await db.query("select append_account_collection_v1($1)", [payment]);
    // Drain ONLY journal checks: leave the real allocator waiting for COMMIT.
    await db.query("set constraints check_account_journal, check_account_journal_order_update immediate");
    await db.query("set constraints check_account_journal, check_account_journal_order_update deferred");
    const { value: cached, checked } = (await db.query(`select current_setting('tabletap.journal_checked') value,
      $1::uuid=any(current_setting('tabletap.journal_checked')::uuid[]) checked`, [owner])).rows[0];
    assert.equal(checked, true);
    assert.equal((await db.query("select count(*)::int n from payment_allocations where payment_id=$1", [payment])).rows[0].n, 0);
    assert.equal((await db.query("update orders set total=total+1 where id=$1", [mismatch])).rowCount, 1);
    // Deliberately restore the stale cache after planting corruption. This
    // isolates the allocator's payment UPDATE as the required invalidation.
    await db.query("select set_config('tabletap.journal_checked',$1,true)", [cached]);
    await db.query("select set_config('tabletap.journal_probe_require_allocation','yes',true)");
    await assert.rejects(async () => { await db.query("commit"); committed = true; }, /account journal source mismatch/);
  } finally {
    await db.query("rollback");
    // A regressed COMMIT must not leave instrumented SQL functions installed.
    if (committed) { await db.query(original); await db.query(finish); }
  }
  assert.equal((await db.query("select count(*)::int n from payments where id=$1", [payment])).rows[0].n, 0);
  assert.equal(await definition("finish_payment_allocation()"), finish);
}

async function probeKitchenCommit(db) {
  const restaurant = randomUUID();
  try {
    await db.query("begin");
    await db.query("insert into restaurants(id,name,plan,plan_status,currency,account_journal_started_at) values($1,'Journal kitchen probe','servicio','active','MXN',now())", [restaurant]);
    const owner = await account(db, restaurant), [id] = await chargedOrders(db, restaurant, owner);
    await db.query("update orders set status='preparing' where id=$1", [id]);
    await db.query("commit");
    await db.query("begin");
    assert.equal((await db.query("update orders set status='ready' where id=$1 and status='preparing'", [id])).rowCount, 1);
    await db.query("commit");
    assert.equal((await db.query("select status from orders where id=$1", [id])).rows[0].status, "ready");
  } finally {
    await db.query("rollback");
    await db.query("delete from restaurants where id=$1", [restaurant]);
  }
  assert.equal((await db.query("select count(*)::int n from orders where restaurant_id=$1", [restaurant])).rows[0].n, 0);
}

async function probeNonMoneyUpdates(db, restaurant, owner, check) {
  await db.query("begin");
  try {
    const ids = [randomUUID(), randomUUID()];
    await db.query(`insert into orders(id,restaurant_id,status,subtotal,total,currency)
      select unnest($1::uuid[]),$2,'preparing',1,1,'MXN'`, [ids, restaurant]);
    const { rows } = await db.query("select account_charge_v2($1,$2,$3,1,'probe') value", [restaurant, owner, [ids[0]]]);
    assert.equal(rows[0].value.outcome, "charged");
    // Drain setup events before planting a failure at the trigger's entry.
    // Even an account-cache hit would fail: these updates must queue no work.
    await db.query("set constraints all immediate");
    const planted = check.replace(/\bbegin\b/i, "begin raise exception 'planted non-money journal trigger';");
    assert.notEqual(planted, check);
    await db.query(planted);
    await db.query("set constraints all deferred");
    for (const change of ["status='ready'", "note='journal probe'"]) {
      assert.equal((await db.query(`update orders set ${change} where id=any($1::uuid[])`, [ids])).rowCount, 2);
    }
    await db.query("set constraints all immediate");
    // Control: cancellation still queues a check for the charged order.
    await assert.rejects(() => db.query("update orders set status='cancelled' where id=$1", [ids[0]]),
      /planted non-money journal trigger/);
  } finally { await db.query("rollback"); }
  console.log("PASS: account/non-account kitchen and note updates queue no journal work; cancellation does (rolled back)");
}
