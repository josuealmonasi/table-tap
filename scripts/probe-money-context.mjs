import assert from "node:assert/strict";
import { randomUUID as id } from "node:crypto";

export const context = (db, restaurant, actor) => {
  const value = async (sql, args = []) => {
    const result = (await db.query(sql, args)).rows[0].value;
    // Each real RPC commits before the next request. Run its deferred checks
    // now, so a rolled-back probe cannot hide an unallocated receipt.
    await db.query('set constraints all immediate');
    await db.query('set constraints all deferred');
    return result;
  };
  const order = async (total = 100, tip = 0, table = {}, card = null, status = 'received', paid = false) => {
    const key = id();
    await db.query(`insert into orders(id,restaurant_id,subtotal,total,tip,currency,status,paid,table_id,session_id,loyalty_card_id)
      values($1,$2,$3::numeric-$4::numeric,$3,$4,'MXN',$5,$6,$7,$8,$9)`,
    [key, restaurant, total, tip, status, paid, table.tableId ?? null, table.sessionId ?? null, card]);
    if (card) assert.equal(await value('select loyalty_card_id value from orders where id=$1', [key]), card);
    return key;
  };
  const table = async (total = 100, card = null) => {
    const tableId = id(), sessionId = id();
    await db.query('insert into restaurant_tables(id,restaurant_id,label) values($1,$2,$3)', [tableId, restaurant, tableId.slice(0, 8)]);
    await db.query('insert into table_sessions(id,restaurant_id,table_id) values($1,$2,$3)', [sessionId, restaurant, tableId]);
    const f = { tableId, sessionId };
    return { ...f, orderId: await order(total, 0, f, card) };
  };
  const coupon = async (amount, kind = 'fixed') => {
    const key = id(), code = key.slice(0, 8);
    await db.query('insert into coupons(id,restaurant_id,code,kind,value) values($1,$2,$3,$4,$5)', [key, restaurant, code, kind, amount]);
    return { id: key, code };
  };
  const card = async () => {
    const key = id();
    await db.query(`insert into loyalty_cards(id,restaurant_id,code,goal,email,email_consent_at,email_notice_version,email_unsubscribe)
      values($1,$2,$3,8,$4,now(),'probe',$5)`, [key, restaurant, key.replaceAll('-', '').slice(0, 12).toUpperCase(),
      `probe-${key}@example.invalid`, id()]);
    return key;
  };
  const state = async key => (await db.query(`select paid,total::float,tip::float,discount::float,ticket_email_skip
    from orders where id=$1 and restaurant_id=$2`, [key, restaurant])).rows[0];
  const outbox = key => value('select count(*)::int value from ticket_email_outbox where order_id=$1 and restaurant_id=$2', [key, restaurant]);
  const pay = (key, expected, currency = 'MXN', skip = false) => value(
    "select settle_orders_v2($1,$2::uuid[],'cash',$3,null::jsonb,$4::numeric,$5,$6) value",
    [restaurant, [key], actor, expected, currency, skip]);
  const part = (f, expected, amount, ref, skip) => value(
    "select collect_table_reviewed_v1($1,$2,$3::numeric,'MXN',$4::numeric,0,'cash',$5,$6,$7) value",
    [restaurant, f.tableId, expected, amount, actor, ref, skip]);
  const start = (f, total, ref = id()) => value(
    "select start_bill_split_v2($1,$2,$3,null::uuid,2,$4::int,'MXN',$5::uuid,300) value",
    [restaurant, f.tableId, f.sessionId, Math.round(total * 100), ref]);
  const slot = (split, slots, cents, ref, skip, revision = 1, tenant = restaurant) => value(
    "select collect_split_slots_v1($1,$2,$3::int,$4::int[],$5::int,'MXN',0,'cash',$6,$7,$8) value",
    [tenant, split, revision, slots, cents, actor, ref, skip]);
  const refused = async (run, pattern) => {
    await db.query('savepoint refusal');
    try { await assert.rejects(run, pattern); }
    finally { await db.query('rollback to savepoint refusal'); await db.query('release savepoint refusal'); }
  };
  return { db, restaurant, actor, value, order, table, coupon, card, state, outbox, pay, part, start, slot, refused, id, assert };
};
