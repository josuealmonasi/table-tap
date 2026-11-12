import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { account, order, settle } from "./account-journal-probe-fixtures.mjs";

// Called only by the development journal probe. Roll back the deletion and
// its archive together so this check leaves no restaurant or accounting rows.
export async function probeJournalArchive(db) {
  const restaurant = randomUUID(), foreign = randomUUID();
  const journal = async id => (await db.query(
    "select to_jsonb(m) as row_data from account_movements m where restaurant_id=$1 order by id", [id],
  )).rows.map(entry => entry.row_data);
  await db.query("begin");
  try {
    for (const id of [restaurant, foreign]) {
      await db.query(`insert into restaurants(id,name,plan,plan_status,currency,account_journal_started_at)
        values($1,'Journal archive probe','casa','active','MXN',clock_timestamp())`, [id]);
      const owner = await account(db, id);
      await order(db, id, owner, 100);
      await settle(db, id, owner, 100);
    }
    await db.query("set constraints all immediate");
    const before = await journal(restaurant), other = await journal(foreign);
    assert(before.some(row => row.kind === "charge"), "the archive must retain the original charge snapshot");
    assert(before.some(row => row.kind === "collection"), "the archive must retain the collection too");
    await db.query("set local role service_role");
    const result = (await db.query("select admin_delete_restaurant($1,false) result", [restaurant])).rows[0].result;
    assert.equal(result.outcome, "deleted");
    assert.deepEqual(await journal(restaurant), []);
    const archived = (await db.query(`select row_data from restaurant_accounting_records
      where restaurant_id=$1 and source_table='account_movements' order by source_id`, [restaurant])).rows;
    assert.deepEqual(archived.map(row => row.row_data), before);
    assert.deepEqual(await journal(foreign), other, "another restaurant's journal must stay untouched");
    console.log("PASS: restaurant deletion archives every journal snapshot and preserves the other tenant");
  } finally {
    await db.query("rollback");
  }
}
