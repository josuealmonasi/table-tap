import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

/** Real database transactions, always rolled back. No provider calls. */
export async function checkPaymentAllocations() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("begin");
    const { rows: [r] } = await db.query("select r.id,r.currency,t.id table_id from restaurants r join restaurant_tables t on t.restaurant_id=r.id order by r.id,t.id limit 1");
    assert(r, "allocation checks require a seeded restaurant and table");
    const order = async (total = 100, extra = {}) => {
      const { rows: [o] } = await db.query(`insert into orders
        (restaurant_id,items,subtotal,total,status,currency,tip,account_id,session_id,created_at)
        values($1,'[]',$2,$2,$3,$4,$5,$6,$7,clock_timestamp()) returning id`,
      [r.id, total, extra.status ?? "received", r.currency, extra.tip ?? 0, extra.account ?? null, extra.session ?? null]);
      return o.id;
    };
    const check = () => db.query("set constraints all immediate");
    const defer = () => db.query("set constraints all deferred");
    const reject = async (sql, args, pattern) => {
      await db.query("savepoint refused");
      await assert.rejects(async () => { await db.query(sql, args); await check(); }, pattern);
      await db.query("rollback to savepoint refused");
    };
    const ids = [await order(), await order(), await order()];
    await db.query("select set_config('tabletap.allocation_writer','v1',true),set_config('tabletap.allocation_scope',$1,true)", [JSON.stringify(ids)]);
    const { rows: [p] } = await db.query("insert into payments(restaurant_id,amount,method,actor_email) values($1,100,'cash','original@example.test') returning id", [r.id]);
    await check();
    const { rows: shares } = await db.query("select order_id,amount from payment_allocations where payment_id=$1 order by amount desc", [p.id]);
    assert.deepEqual(shares.map(a => Number(a.amount)), [33.34, 33.33, 33.33]);
    await reject("update payments set amount=101 where id=$1", [p.id], /immutable/);
    await reject("update payment_allocations set amount=1 where payment_id=$1", [p.id], /immutable/);
    await reject("select settle_orders($1,$2,'cash','cashier',null)", [r.id, ids], /not_owed/);
    await reject("update orders set total=99,tip=-1 where id=$1", [ids[1]], /adjustment/);
    await defer();
    const args = [r.id, shares[0].order_id];
    const { rows: [cancel] } = await db.query("select prepare_order_refund($1,$2,'manager','[]',false,null,null,null) result", args);
    assert.equal(cancel.result.outcome, "cancelled");
    const { rows: [op] } = await db.query("select * from refund_operations where adjustment_id=$1", [cancel.result.adjustment]);
    assert.equal(Number(op.amount), 33.34);
    assert.equal(op.status, "pending");
    const { rows: [again] } = await db.query("select prepare_order_refund($1,$2,'manager','[]',false,null,null,null) result", args);
    assert.equal(again.result.adjustment, cancel.result.adjustment);
    await db.query("select finish_refund_operation($1,$2,'manager',null,'succeeded')", [r.id, op.id]);
    await check();
    const { rows: [done] } = await db.query("select status,confirmed_by,payout_actor from refund_operations where id=$1", [op.id]);
    assert.equal(done.status, "succeeded");
    assert.equal(done.confirmed_by, "manager");
    assert.equal(done.payout_actor, "original@example.test");
    assert.equal(Number((await db.query("select retained_order_coverage($1,$2) n", args)).rows[0].n), 0);

    const { rows: [other] } = await db.query("select id from restaurants where id<>$1 order by id limit 1", [r.id]);
    assert(other, "allocation checks require a second tenant");
    await reject("insert into payments(restaurant_id,order_id,amount,method) values($1,$2,1,'cash')", [other.id, ids[1]], /another restaurant/);
    await reject(`with op as (insert into refund_operations(restaurant_id,adjustment_id,source,amount,tip,currency)
      values($1,$2,'cash',1,0,$3) returning id)
      insert into refund_allocations(restaurant_id,operation_id,allocation_id,amount,tip)
      select $1,op.id,a.id,1,0 from op,payment_allocations a where a.order_id=$4`,
    [r.id, cancel.result.adjustment, r.currency, shares[0].order_id], /exceeds original coverage/);

    await defer();
    const counter = await order(110, { tip: 10, status: "pending_payment" });
    await db.query("select settle_sale($1,$2,'cash','probe','completed')", [r.id, counter]);
    await check();
    const { rows: [counterReceipt] } = await db.query("select amount,tip,unallocated_amount,unallocated_tip from payments where order_id=$1", [counter]);
    assert.deepEqual(Object.values(counterReceipt).map(Number), [110, 10, 0, 0]);

    // Full account settlement includes tips already stored on an order.
    await defer();
    const { rows: [account] } = await db.query(`insert into customer_accounts(restaurant_id,name,code,credit_limit,opened_by)
      values($1,'Allocation probe',$2,10000,'probe') returning id`, [r.id, randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()]);
    const a = await order(110, { tip: 10, account: account.id });
    await db.query("select account_settle($1,$2,110,5,'cash','probe',$3)", [r.id, account.id, randomUUID()]);
    await check();
    const { rows: [funded] } = await db.query("select total,tip,paid,retained_order_coverage(restaurant_id,id) covered from orders where id=$1", [a]);
    assert.equal(Number(funded.total), 115);
    assert.equal(Number(funded.covered), 115);
    assert.equal(funded.paid, true);

    // A later round never joins a frozen split's payment or close.
    await defer();
    const { rows: [session] } = await db.query("insert into table_sessions(restaurant_id,table_id,closed_at) values($1,$2,now()) returning id", [r.id, r.table_id]);
    const frozen = [await order(100, { session: session.id }), await order(100, { session: session.id })];
    const { rows: [split] } = await db.query(`insert into bill_splits(restaurant_id,session_id,shares,amount,status,proposed_by,locked_at,order_ids)
      values($1,$2,2,200,'locked','probe',clock_timestamp(),$3) returning id`, [r.id, session.id, frozen]);
    await db.query("insert into bill_split_claims(split_id,share_no,diner,amount) values($1,0,'one',100),($1,1,'two',100)", [split.id]);
    const later = await order(50, { session: session.id });
    for (const no of [0, 1]) {
      await db.query("select settle_split_share($1,$2,100,8,$3)", [split.id, no, `pi_probe_${randomUUID()}`]);
      await check(); await defer();
    }
    assert.equal((await db.query("select close_divided_bill($1) closed", [split.id])).rows[0].closed, true);
    await check();
    assert.equal((await db.query("select paid from orders where id=$1", [later])).rows[0].paid, false);
    const { rows: [leaked] } = await db.query("select count(*) n from payment_allocations where order_id=$1", [later]);
    assert.equal(Number(leaked.n), 0);
    // A provider-confirmed failure gets a separately keyed durable retry.
    await defer();
    await db.query("update restaurants set stripe_account_id='acct_probe' where id=$1", [r.id]);
    const card = await order(50, { status: "pending_payment" });
    await db.query("select settle_card_orders($1,$2,0,null,'received',50)", [[card], `pi_probe_${randomUUID()}`]);
    await check(); await defer();
    await db.query("select prepare_order_refund($1,$2,'manager','[]',true,null,null,null)", [r.id, card]);
    await check();
    const { rows: [stripeOp] } = await db.query("select f.id from refund_operations f join order_adjustments a on a.id=f.adjustment_id where a.order_id=$1", [card]);
    const { rows: [first] } = await db.query("select start_refund_attempt($1,$2) attempt", [r.id, stripeOp.id]);
    await db.query("select finish_refund_operation($1,$2,'manager','re_failed','failed',null,$3)", [r.id, stripeOp.id, first.attempt.id]);
    const { rows: [second] } = await db.query("select start_refund_attempt($1,$2) attempt", [r.id, stripeOp.id]);
    assert.equal(second.attempt.attempt_no, 2);
    assert.notEqual(second.attempt.idempotency_key, first.attempt.idempotency_key);
    assert.equal(second.attempt.amount, first.attempt.amount);
    assert.equal((await db.query("select finish_refund_operation($1,$2,'manager','re_failed','failed',null,$3) done", [r.id, stripeOp.id, first.attempt.id])).rows[0].done, false);
    console.log("    ok       allocation cents, immutable receipts, stale collection, partial return, account tips and frozen split scope");
  } finally {
    await db.query("rollback");
    await db.end();
  }
}
