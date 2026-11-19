// Development evidence only. Every fixture and money write is rolled back.
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import path from "node:path";
import pg from "pg";
import { context } from "./probe-money-context.mjs";
import money from "./probe-money-cases.mjs";
import splits from "./probe-split-cases.mjs";
import allocation from "./probe-allocation-cases.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.DATABASE_URL) process.loadEnvFile(path.join(root, '.env.development.local'));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', connectionString = process.env.DATABASE_URL ?? '';
const project = url ? new URL(url).hostname.split('.')[0] : '';
if (process.argv.includes('--prod') || process.env.NODE_ENV === 'production' || !project || !connectionString.includes(project)
  || `${url} ${connectionString}`.includes('vayymkzrvlepoksualku')) {
  throw new Error('refusing production or an unknown SQL target');
}
const db = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, statement_timeout: 15000, connectionTimeoutMillis: 10000 });
const restaurant = randomUUID(), owner = randomUUID(), actor = `followups-${owner}@probe.invalid`;
const c = context(db, restaurant, actor);
let failures = 0, started = false;
async function check(name, run) {
  await db.query('savepoint followup_check');
  try {
    await run();
    await db.query('set constraints all immediate');
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.message.replaceAll('\n', ' ')}`);
  } finally {
    await db.query('rollback to savepoint followup_check');
    await db.query('release savepoint followup_check');
  }
}
(async () => {
  try {
    await db.connect();
    await db.query('begin'); started = true;
    const signatures = [
      'snapshot_payment_scope()',
      'finish_payment_allocation()',
      'payment_allocations_need_backfill(uuid)',
      'approve_discount_request_v2(uuid,uuid,text,numeric)',
      'apply_bill_discount(uuid,uuid[],uuid,numeric)',
      'start_bill_split_v2(uuid,uuid,uuid,uuid,integer,integer,text,uuid,integer)',
      'settle_orders_v2(uuid,uuid[],text,text,jsonb,numeric,text,boolean)',
      'collect_table_reviewed_v1(uuid,uuid,numeric,text,numeric,numeric,text,text,text,boolean)',
      'collect_split_slots_v1(uuid,uuid,integer,integer[],integer,text,integer,text,text,text,boolean)',
    ];
    for (const signature of signatures) {
      const { rows: [p] } = await db.query(`select prosecdef,proconfig,
        has_function_privilege('anon',oid,'EXECUTE') anon,
        has_function_privilege('authenticated',oid,'EXECUTE') authenticated,
        has_function_privilege('service_role',oid,'EXECUTE') service
        from pg_proc where oid=to_regprocedure($1)`, [`public.${signature}`]);
      assert.ok(p, `${signature} missing: apply the branch schema first`);
      assert.ok(p.prosecdef && p.proconfig.includes('search_path=public') && !p.anon && !p.authenticated && p.service);
    }
    console.log('PASS all nine changed functions are service-only security definers with a fixed search path');
    await db.query("insert into auth.users(id,email,aud,role) values($1,$2,'authenticated','authenticated')", [owner, actor]);
    await db.query("insert into restaurants(id,name,owner_id,plan,plan_status,currency) values($1,'Follow-up SQL probe',$2,'casa','active','MXN')", [restaurant, owner]);
    await db.query('insert into loyalty_programs(restaurant_id,active) values($1,true)', [restaurant]);
    await c.value('select open_cash_shift($1,$2,0) value', [restaurant, actor]);
    await money(c, check);
    await splits(c, check);
    await allocation(c, check);
  } finally {
    if (started) await db.query('rollback');
    await db.end();
  }
  if (failures) process.exitCode = 1;
  console.log(failures ? `${failures} follow-up SQL probe(s) failed` : 'PASS all follow-up SQL probes; every fixture rolled back');
})().catch(error => { console.error('FAIL follow-up SQL probe:', error.message); process.exitCode = 1; });
