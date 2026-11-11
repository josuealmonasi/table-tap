import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// A planted second-call failure exercises the real deferred trigger. All
// function replacements and source rows roll back, including on failure.
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
  assert.equal(await definition("assert_account_journal_v1(uuid)"), original);
  assert.equal(await definition("check_account_journal_v1()"), check);
  console.log("PASS: two source rows assert once; removing the cache guard hits the planted second-call failure (rolled back)");
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
