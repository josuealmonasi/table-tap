import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { account, queued } from "./account-journal-probe-fixtures.mjs";

const value = async (db, sql, args) => (await db.query(sql, args)).rows[0].value;
export async function debtMatches(db, owner) {
  const { rows } = await db.query(`select currency,coalesce(m.debt,0)::text journal,coalesce(o.debt,0)::text debt
    from (select currency,sum(debt_delta_cents) debt from account_movements where account_id=$1 group by currency) m
    full join (select currency,sum(round(total*100)) debt from orders where account_id=$1
      and not paid and not written_off and status <> 'cancelled' group by currency) o using(currency)`, [owner]);
  assert(rows.every(row => row.journal === row.debt), JSON.stringify(rows));
}
async function charge(db, restaurant, owner, total = 100, status = "completed") {
  const id = randomUUID();
  await db.query("insert into orders(id,restaurant_id,status,subtotal,total,currency) values($1,$2,$3,$4,$4,'MXN')", [id, restaurant, status, total]);
  const result = await value(db, "select account_charge_v2($1,$2,$3,$4,'probe') value", [restaurant, owner, [id], total]);
  assert.equal(result.outcome, "charged");
  const count = (await db.query("select count(*)::int n from account_movements where order_id=$1", [id])).rows[0].n;
  assert.equal((await value(db, "select account_charge_v2($1,$2,$3,$4,'probe') value", [restaurant, owner, [id], total])).outcome, "stale");
  assert.equal((await db.query("select count(*)::int n from account_movements where order_id=$1", [id])).rows[0].n, count);
  await debtMatches(db, owner);
  return id;
}
const credit = (db, r, id, amount, expected, request) => value(db,
  "select account_credit_v1($1,$2,$3,$4,'error','journal probe','probe',$5) value", [r, id, amount, expected, request]);
const settle = (db, r, owner, expected, tip, ref) => value(db,
  "select account_settle_currency_v1($1,$2,$3,$4,'cash','probe',$5,'MXN') value", [r, owner, expected, tip, ref]);
async function commitRefused(db, action, pattern) {
  await db.query("begin");
  try { await action(); await assert.rejects(() => db.query("commit"), pattern); }
  finally { await db.query("rollback"); }
}

async function replay(db, owner, action) {
  const snapshot = async () => (await db.query(`select jsonb_build_object(
    'movements',(select coalesce(jsonb_agg(to_jsonb(m) order by id),'[]') from account_movements m where account_id=$1),
    'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from payments p where account_id=$1)) state`, [owner])).rows[0].state;
  const before = await snapshot(), result = await action();
  assert.deepEqual(await snapshot(), before);
  return result;
}

export async function probeLiveJournal(db, peer, restaurant, peerPid, mixedOwner) {
  // Exercise the real activation file, including empty-restaurant birth and
  // replay, then roll back ALL its effects outside this isolated restaurant.
  const activation = await readFile(new URL("../supabase/journal-activate.sql", import.meta.url), "utf8");
  await db.query("begin");
  await db.query(activation);
  const born = await account(db, restaurant);
  assert((await db.query("select journal_started_at from customer_accounts where id=$1", [born])).rows[0].journal_started_at);
  await db.query(activation);
  await debtMatches(db, born);
  await db.query("rollback");
  // Activate only our fixture for the remaining committed writer/race probes.
  await db.query("begin");
  await db.query("select lock_restaurant_money($1)", [restaurant]);
  await db.query("select account_journal_backfill_v1($1,clock_timestamp())", [restaurant]);
  await db.query("update restaurants set account_journal_started_at=now() where id=$1", [restaurant]);
  await db.query("commit");
  // One currency collected while another is still owed: a partial ACCOUNT
  // collection. Deployed staff RPCs intentionally collect a whole currency.
  const ref = `journal-live:${randomUUID()}`;
  const before = (await db.query("select account_owed($1) owed", [mixedOwner])).rows[0].owed;
  const mxn = (await db.query("select sum(total) owed from orders where account_id=$1 and currency='MXN' and not paid and not written_off and status<>'cancelled'", [mixedOwner])).rows[0].owed;
  assert(Number(before) > Number(mxn));
  assert.equal((await settle(db, restaurant, mixedOwner, mxn, 5, ref)).outcome, "paid");
  await debtMatches(db, mixedOwner);
  assert.equal((await replay(db, mixedOwner, () => settle(db, restaurant, mixedOwner, mxn, 5, ref))).outcome, "duplicate");
  await debtMatches(db, mixedOwner);

  const owner = await account(db, restaurant);
  assert((await db.query("select journal_started_at from customer_accounts where id=$1", [owner])).rows[0].journal_started_at);
  const id = await charge(db, restaurant, owner);
  const request = randomUUID();
  const credited = await credit(db, restaurant, id, 2000, 10000, request);
  assert.equal(credited.outcome, "credited"); await debtMatches(db, owner);
  assert.deepEqual(await replay(db, owner, () => credit(db, restaurant, id, 2000, 10000, request)), credited);
  const checkout = await value(db, "select account_checkout_currency_v1($1,$2,80,4,0,'MXN') value", [restaurant, owner]);
  assert.equal(checkout.outcome, "open");
  const intent = `pi_journal_${randomUUID()}`;
  assert.equal((await value(db, "select account_checkout_settle_v2($1,$2) value", [checkout.checkout, intent])).outcome, "paid");
  await debtMatches(db, owner);
  assert.equal((await replay(db, owner, () => value(db, "select account_checkout_settle_v2($1,$2) value", [checkout.checkout, intent]))).outcome, "duplicate");
  await debtMatches(db, owner);
  const cancelled = await charge(db, restaurant, owner, 30, "received");
  const cancel = () => value(db, "select prepare_order_refund($1,$2,'probe','{}',false,$3,null,null) value", [restaurant, cancelled, owner]);
  const result = await cancel(); assert.equal(result.outcome, "cancelled");
  await debtMatches(db, owner); assert.deepEqual(await replay(db, owner, cancel), result); await debtMatches(db, owner);
  // Legacy cancellation has no actor argument. It creates one unique cancel
  // adjustment and uses the charged_by actor (or system), never an invented ID.
  const legacy = await charge(db, restaurant, owner, 10, "received");
  const legacyCancel = () => value(db, "select cancel_order_v2($1,$2,null,'{}',false,$3,null,null) value", [restaurant, legacy, owner]);
  assert.equal(await legacyCancel(), true); await debtMatches(db, owner);
  assert.equal(await replay(db, owner, legacyCancel), false); await debtMatches(db, owner);

  await charge(db, restaurant, owner, 0);
  const forgotten = await charge(db, restaurant, owner, 50);
  await commitRefused(db, () => db.query("update orders set paid=true where id=$1", [forgotten]), /account journal/);
  const orphan = (await db.query("select id from orders where account_id=$1 and charged_at is null limit 1", [mixedOwner])).rows[0].id;
  await commitRefused(db, () => db.query(`insert into account_movements(restaurant_id,account_id,currency,kind,
    amount_cents,debt_delta_cents,occurred_at,operation_ref,order_id,provenance,charge_snapshot)
    values($1,$2,'MXN','charge',1,1,now(),'orphan',$3,'live','{}')`, [restaurant, mixedOwner, orphan]), /account journal/);
  await debtMatches(db, owner);

  for (const winner of ["credit", "settle"]) {
    const racer = await account(db, restaurant), source = await charge(db, restaurant, racer);
    await db.query("begin"); await db.query("select lock_restaurant_money($1)", [restaurant]);
    const pending = (async () => {
      await peer.query("begin");
      const result = winner === "credit" ? await settle(peer, restaurant, racer, 100, 0, randomUUID())
        : await credit(peer, restaurant, source, 2000, 10000, randomUUID());
      await peer.query("commit"); return result;
    })().then(result => ({ result }), error => ({ error }));
    try {
      await queued(db, peerPid);
      if (winner === "credit") assert.equal((await credit(db, restaurant, source, 2000, 10000, randomUUID())).outcome, "credited");
      else assert.equal((await settle(db, restaurant, racer, 100, 0, randomUUID())).outcome, "paid");
      await db.query("commit");
    } catch (error) { await db.query("rollback"); await pending; throw error; }
    const finished = await pending;
    if (finished.error) throw finished.error;
    assert.equal(finished.result.outcome, winner === "credit" ? "changed" : "ineligible");
    await debtMatches(db, racer);
  }
  console.log("PASS: activation, born started, live charge/credit/staff tip/online tip/cancellation, replay, both credit-settle races, forgotten and orphan append refused at COMMIT");
}
