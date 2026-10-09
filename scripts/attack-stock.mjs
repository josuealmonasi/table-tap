// Database behavior, including simultaneous webhook retries. Dedicated fixtures
// only: all rows belong to the restaurant below and are deleted in finally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { checkStockReturns } from "./money-stock.mjs";

export async function attackStock({ admin, ok, bad }) {
  const config = { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } };
  const db = new pg.Client(config);
  const peer = new pg.Client(config);
  const restaurant = randomUUID(), item = randomUUID(), untracked = randomUUID();
  const coupon = randomUUID();
  const demand = [{ item_id: item, qty: 2 }, { item_id: untracked, qty: 1 }];
  async function reserve(lines = demand) {
    const id = randomUUID();
    const { rows } = await db.query("select reserve_stock($1,$2,3,$3) as result", [restaurant, JSON.stringify(lines), id]);
    assert.equal(rows[0].result.ok, true);
    return id;
  }
  async function count() {
    return (await db.query("select stock from menu_items where id=$1", [item])).rows[0].stock;
  }
  async function order(reservation) {
    const { rows } = await db.query("insert into orders(restaurant_id,stock_reservation_id) values($1,$2) returning id", [restaurant, reservation]);
    return rows[0].id;
  }
  async function release(id) {
    await db.query("select release_stock_reservation($1,$2)", [restaurant, id]);
  }
  try {
    await db.connect(); await peer.connect();
    await db.query("insert into restaurants(id,name,plan,plan_status) values($1,'Stock recovery test','servicio','active')", [restaurant]);
    await db.query("insert into menu_items(id,restaurant_id,name,stock) values($1,$3,'Counted',10),($2,$3,'Untracked',null)", [item, untracked, restaurant]);
    await db.query("insert into coupons(id,restaurant_id,code,kind,value,uses_count) values($1,$2,'RECOVERY','fixed',1,1)", [coupon, restaurant]);

    const first = await reserve(), pending = await order(first);
    await db.query("insert into coupon_redemptions(restaurant_id,coupon_id,order_id,code,amount) values($1,$2,$3,'RECOVERY',1)", [restaurant, coupon, pending]);
    await Promise.all([db, peer].map(c => c.query("select abandon_checkout($1,true)", [pending])));
    assert.equal(await count(), 10);
    assert.equal((await db.query("select uses_count from coupons where id=$1", [coupon])).rows[0].uses_count, 0);
    ok("concurrent expiry returns stock and coupon once");

    // A bill paid at the till can still have an online coupon checkout expire.
    // Its food stays paid; the unused coupon must not stay consumed forever.
    const paidBill = (await db.query("insert into orders(restaurant_id,status,paid) values($1,'received',true) returning id", [restaurant])).rows[0].id;
    await db.query("update coupons set uses_count=1 where id=$1", [coupon]);
    await db.query("insert into coupon_redemptions(restaurant_id,coupon_id,order_id,code,amount) values($1,$2,$3,'RECOVERY',1)", [restaurant, coupon, paidBill]);
    await Promise.all([db, peer].map(c => c.query("select abandon_checkout($1,false)", [paidBill])));
    assert.equal((await db.query("select uses_count from coupons where id=$1", [coupon])).rows[0].uses_count, 0);
    assert.equal((await db.query("select paid from orders where id=$1", [paidBill])).rows[0].paid, true);
    ok("expiry returns an unused coupon on a bill paid offline without deleting the food");

    const second = await reserve(), placed = await order(second);
    await db.query("update restaurants set plan='carta' where id=$1", [restaurant]);
    await db.query("update menu_items set stock=30 where id=$1", [untracked]);
    await assert.rejects(release(second), /live order/);
    await db.query("update orders set status='cancelled' where id=$1", [placed]);
    await db.query("update orders set status='cancelled' where id=$1", [placed]);
    assert.equal(await count(), 10);
    assert.equal((await db.query("select stock from menu_items where id=$1", [untracked])).rows[0].stock, 30);
    ok("downgrade does not block return; newly tracked items are not credited");

    const third = await reserve([{ item_id: item, qty: 2 }]);
    await db.query("update menu_items set stock=null where id=$1", [item]);
    await db.query("update menu_items set stock=7 where id=$1", [item]);
    await release(third); await release(third);
    assert.equal(await count(), 7);
    ok("a tracking restart does not receive an old reservation");

    const fourth = await reserve([{ item_id: item, qty: 2 }]), held = await order(fourth);
    await db.query("update coupons set uses_count=1 where id=$1", [coupon]);
    await db.query("insert into coupon_redemptions(restaurant_id,coupon_id,order_id,code,amount) values($1,$2,$3,'RECOVERY',1)", [restaurant, coupon, held]);
    // Trigger a genuine stock-update failure without installing a global trigger.
    await db.query("begin");
    await db.query("update menu_items set stock=2147483647 where id=$1", [item]);
    await db.query("savepoint release_failure");
    await assert.rejects(db.query("select abandon_checkout($1,true)", [held]), /out of range/);
    await db.query("rollback to release_failure");
    assert.equal((await db.query("select count(*)::int n from orders where id=$1", [held])).rows[0].n, 1);
    assert.equal((await db.query("select released_at from stock_reservations where id=$1", [fourth])).rows[0].released_at, null);
    assert.equal((await db.query("select uses_count from coupons where id=$1", [coupon])).rows[0].uses_count, 1);
    assert.equal((await db.query("select count(*)::int n from coupon_redemptions where order_id=$1", [held])).rows[0].n, 1);
    await db.query("rollback");
    await db.query("select abandon_checkout($1,true)", [held]);
    assert.equal((await db.query("select uses_count from coupons where id=$1", [coupon])).rows[0].uses_count, 0);
    assert.equal(await count(), 7);
    ok("failed stock return rolls back deletion and can be retried");

    const orphan = await reserve([{ item_id: item, qty: 2 }]);
    await db.query("update stock_reservations set created_at=now()-interval '2 hours' where id=$1", [orphan]);
    const warnings = [];
    await checkStockReturns(admin, { ok: () => {}, bad: message => warnings.push(message) });
    assert.ok(warnings.some(message => message.includes(orphan)));
    await db.query("select recover_stock_reservations($1)", [restaurant]);
    assert.equal(await count(), 7);
    await assert.rejects(order(orphan), /Invalid stock reservation/);
    const live = await reserve([{ item_id: item, qty: 2 }]);
    await order(live);
    await db.query("update stock_reservations set created_at=now()-interval '2 hours' where id=$1", [live]);
    await db.query("select recover_stock_reservations($1)", [restaurant]);
    assert.equal(await count(), 5);
    ok("recovery returns old orphans, rejects late binding, preserves live orders");

    // Old workers can finish during rollout. Their legacy quantities return
    // inside the same guarded transaction; new untracked orders never use them.
    const legacy = (await db.query("insert into orders(restaurant_id,status) values($1,'received') returning id", [restaurant])).rows[0].id;
    const oldDemand = JSON.stringify([{ item_id: item, qty: 2 }]);
    const outcomes = await Promise.all([db, peer].map(c => c.query(
      "select cancel_order($1,$2,null,$3) as moved", [restaurant, legacy, oldDemand])));
    assert.equal(outcomes.filter(r => r.rows[0].moved).length, 1);
    assert.equal(await count(), 7);
    const managed = (await db.query("insert into orders(restaurant_id,status,stock_managed) values($1,'received',true) returning id", [restaurant])).rows[0].id;
    await db.query("select cancel_order($1,$2,null,$3)", [restaurant, managed, oldDemand]);
    assert.equal(await count(), 7);
    ok("legacy cancellation is atomic; new untracked orders cannot invent stock");

    const stalled = await reserve([{ item_id: item, qty: 1 }]);
    await order(stalled);
    await db.query("update stock_reservations set created_at=now()-interval '2 hours' where id=$1", [stalled]);
    const stalledWarnings = [];
    await checkStockReturns(admin, { ok: () => {}, bad: message => stalledWarnings.push(message) });
    assert.ok(stalledWarnings.some(message => message.includes(stalled) && message.includes("verify its Stripe")));
    ok("stalled pending checkouts are visible without automatically releasing live stock");

    for (const signature of [
      "reserve_stock(uuid,jsonb,integer,uuid)", "release_stock_reservation(uuid,uuid)",
      "abandon_checkout(uuid,boolean,jsonb)", "cancel_order(uuid,uuid,text,jsonb)",
      "recover_stock_reservations(uuid)",
    ]) {
      const { rows } = await db.query(
        "select has_function_privilege('anon',$1,'execute') a, has_function_privilege('authenticated',$1,'execute') b", [signature]);
      assert.equal(rows[0].a, false); assert.equal(rows[0].b, false);
    }
    ok("all stock and cancellation functions remain restricted to the server");

    await db.query("begin");
    await db.query("set local role authenticated");
    await assert.rejects(db.query("select recover_stock_reservations($1)", [restaurant]), /permission denied/);
    await db.query("rollback");
    ok("signed-in browsers cannot run stock recovery");
  } catch (error) {
    bad(`stock recovery: ${error.message}`);
  } finally {
    await db.query("rollback").catch(() => {});
    await db.query("delete from restaurants where id=$1", [restaurant]);
    await Promise.all([db.end(), peer.end()]);
  }
}
