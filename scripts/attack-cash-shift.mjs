// Dedicated restaurant and two transactions: hold a withdrawal behind the
// money lock, close first, then judge the drawer's rows and total after it runs.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import pg from "pg";

export async function attackCashShift({ ok, bad }) {
  const config = { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, statement_timeout: 10000 };
  const db = new pg.Client(config), peer = new pg.Client(config);
  const restaurant = randomUUID();
  let made = false;
  let pending;
  async function queued() {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      await db.query("select pg_stat_clear_snapshot()");
      const { rows } = await db.query("select wait_event_type from pg_stat_activity where pid=$1", [peer.processID]);
      if (rows[0]?.wait_event_type === "Lock") return;
      await pause(20);
    }
    throw new Error("the withdrawal did not wait for the money lock");
  }
  async function totals(shift) {
    return (await db.query("select cash_shift_totals($1,$2,clock_timestamp()) value", [restaurant, shift])).rows[0].value;
  }
  try {
    await db.connect(); await peer.connect();
    await db.query("insert into restaurants(id,name,plan,plan_status,currency) values($1,'Cash shift race test','servicio','active','MXN')", [restaurant]);
    made = true;
    for (const action of ["create", "delete"]) {
      const shift = (await db.query("insert into cash_shifts(restaurant_id,opened_by,opening_amount) values($1,'shift-race',100) returning id", [restaurant])).rows[0].id;
      const movement = (await db.query("select create_cash_withdrawal($1,$2,20,null,'shift-race') value", [restaurant, shift])).rows[0].value.id;
      // This is the id the route read while open. Its RPC reaches the lock
      // after close has acquired it, so that earlier read proves nothing.
      await db.query("begin");
      await db.query("select lock_restaurant_money($1)", [restaurant]);
      const sql = action === "create" ? "select create_cash_withdrawal($1,$2,10,null,'shift-race') value"
        : "select delete_cash_withdrawal($1,$2,$3) value";
      // Catch immediately: an early query failure must not become unhandled
      // while this connection is checking whether its peer reached the lock.
      pending = peer.query(sql, action === "create" ? [restaurant, shift] : [restaurant, shift, movement])
        .then(result => ({ result }), error => ({ error }));
      await queued();
      const closed = (await db.query("select close_cash_shift($1,$2,80,'shift-race') value", [restaurant, shift])).rows[0].value;
      assert.equal(Number(closed.expected), 80);
      await db.query("commit");
      const answer = await pending;
      pending = null;
      if (answer.error) throw answer.error;
      assert.equal(answer.result.rows[0].value, null);
      assert.equal(Number((await totals(shift)).expected), 80);
      const { rows } = await db.query("select expected_cash,(select count(*)::int from cash_movements where shift_id=$1) movements from cash_shifts where id=$1", [shift]);
      assert.equal(Number(rows[0].expected_cash), 80);
      assert.equal(rows[0].movements, 1);
      ok(`close wins against withdrawal ${action}: the signed and reviewed drawer stay at MXN 80`);
    }
  } catch (error) {
    bad(`cash shift race: ${error.message}`);
  } finally {
    // Release the lock before awaiting a queued peer, even on a failed assertion.
    try {
      await db.query("rollback").catch(() => {});
      if (pending) await pending;
      if (made) await db.query("delete from restaurants where id=$1", [restaurant]);
    } finally {
      await Promise.allSettled([db.end(), peer.end()]);
    }
  }
}
