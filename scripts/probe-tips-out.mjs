// Development SQL evidence only. Claude must apply PROPOSAL-tips-out.sql first.
// All fixtures and checks share one transaction; savepoints and final rollback
// keep even successful checks from leaving changes behind.
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
let shift;
const value = async (sql, args) => (await db.query(sql, args)).rows[0].value;
const totals = () => value("select cash_shift_totals($1,$2,clock_timestamp()) value", [restaurant, shift]);
const movement = async id => (await db.query("select purpose,amount,shift_id,request_ref from cash_movements where id=$1", [id])).rows[0];

async function check(name, run) {
  await db.query("savepoint tips_out_check");
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    process.exitCode = 1;
    console.error(`FAIL ${name}: ${error.message.replaceAll("\n", " ")}`);
  } finally {
    await db.query("rollback to savepoint tips_out_check");
    await db.query("release savepoint tips_out_check");
  }
}

try {
  await db.connect();
  await db.query("begin");
  await db.query("insert into restaurants(id,name,plan,plan_status,currency) values($1,'Tips-out probe','servicio','active','MXN')", [restaurant]);
  shift = await value("select open_cash_shift($1,'probe',20) value", [restaurant]);
  assert.ok(shift, "the isolated shift must open");

  await check("column default stores other when purpose is omitted", async () => {
    const { rows } = await db.query(`select column_default,is_nullable from information_schema.columns
      where table_schema='public' and table_name='cash_movements' and column_name='purpose'`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].column_default, "'other'::text");
    assert.equal(rows[0].is_nullable, "NO");
    const row = (await db.query(`insert into cash_movements(restaurant_id,shift_id,currency,kind,amount,actor_email)
      values($1,$2,'MXN','withdrawal',1,'probe') returning purpose`, [restaurant, shift])).rows[0];
    assert.equal(row.purpose, "other");
  });

  await check("check constraint rejects bonus without a row", async () => {
    const before = await value("select count(*)::int value from cash_movements where restaurant_id=$1", [restaurant]);
    await db.query("savepoint invalid_purpose");
    let rejected;
    try {
      await db.query(`insert into cash_movements(restaurant_id,shift_id,currency,kind,amount,actor_email,purpose)
        values($1,$2,'MXN','withdrawal',1,'probe','bonus')`, [restaurant, shift]);
    } catch (error) { rejected = error; }
    await db.query("rollback to savepoint invalid_purpose");
    await db.query("release savepoint invalid_purpose");
    assert.equal(rejected?.code, "23514", "bonus must violate a CHECK constraint");
    assert.equal(rejected?.table, "cash_movements");
    assert.match(rejected?.constraint ?? "", /purpose/i, "the purpose constraint must reject bonus");
    assert.equal(await value("select count(*)::int value from cash_movements where restaurant_id=$1", [restaurant]), before);
  });

  await check("create_cash_withdrawal accepts missing purpose", async () => {
    const result = await value("select create_cash_withdrawal($1,$2,2,'legacy','probe') value", [restaurant, shift]);
    assert.ok(result?.id, "legacy writer must return an id");
    const row = await movement(result.id);
    assert.equal(row.purpose, "other");
    assert.equal(Number(row.amount), 2);
    assert.equal(row.shift_id, shift);
  });

  await check("create_cash_withdrawal_once accepts missing purpose", async () => {
    const ref = randomUUID();
    const result = await value("select create_cash_withdrawal_once($1,$2,3,'legacy retry','probe',$3) value", [restaurant, shift, ref]);
    assert.ok(result?.id, "retry writer must return an id");
    const row = await movement(result.id);
    assert.equal(row.purpose, "other");
    assert.equal(Number(row.amount), 3);
    assert.equal(row.shift_id, shift);
    assert.equal(row.request_ref, ref);
  });

  await check("cash_shift_totals reports tips_out without changing expected", async () => {
    await db.query(`insert into payments(restaurant_id,amount,tip,method,actor_email,currency,created_at)
      values($1,110,10,'cash','probe','MXN',clock_timestamp())`, [restaurant]);
    const before = await totals();
    assert.equal(Number(before.tips_out), 0);
    assert.equal(Number(before.expected), 130);
    const tips = await value("select create_cash_withdrawal($1,$2,8.5,'staff tips','probe','tips') value", [restaurant, shift]);
    const other = await value("select create_cash_withdrawal_once($1,$2,6.5,'other','probe',$3,'other') value", [restaurant, shift, randomUUID()]);
    assert.ok(tips?.id && other?.id, "both withdrawals must be written");
    const after = await totals();
    assert.equal(Number(after.tips), 10);
    assert.equal(Number(after.cashSales), 110);
    assert.equal(Number(after.withdrawn), 15);
    assert.equal(Number(after.tips_out), 8.5);
    assert.equal(Number(after.expected), 115);
    await db.query("update cash_movements set purpose='other' where id=$1", [tips.id]);
    const reclassified = await totals();
    assert.equal(Number(reclassified.tips_out), 0);
    assert.equal(Number(reclassified.withdrawn), 15);
    assert.equal(Number(reclassified.expected), Number(after.expected));
  });
} catch (error) {
  process.exitCode = 1;
  console.error(`FAIL probe setup or execution: ${error.message.replaceAll("\n", " ")}`);
} finally {
  try { await db.query("rollback"); }
  catch (error) { process.exitCode = 1; console.error(`FAIL rollback: ${error.message}`); }
  finally { await db.end(); }
}
