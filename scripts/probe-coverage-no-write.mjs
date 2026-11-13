// Development SQL evidence that a bill coverage read no longer writes.
// Run after db:create of this branch: node scripts/probe-coverage-no-write.mjs
//
// For every restaurant whose allocations are complete, order_coverage runs
// inside `begin read only` (a write, a row lock or the old backfill's
// SELECT ... FOR UPDATE would fail there) and must equal the old body: the
// coverage computed straight from the allocations, which is what the old
// function returned after a backfill that found nothing to do.
// Restaurants that still need a backfill are listed; the old function wrote
// there too. With --prove-noop, each complete restaurant also runs the old
// backfill in a transaction that is rolled back, and its money rows must be
// unchanged, proving the skipped call was a no-op.
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
const proveNoop = process.argv.includes("--prove-noop");
const db = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, statement_timeout: 20000 });

// order_coverage's body, without the backfill.
const OLD_BODY = `select coalesce(jsonb_agg(jsonb_build_object('id', o.id,
    'unresolved', exists(select 1 from payments p where p.restaurant_id = $1 and p.allocation_quality = 'unresolved'
      and (p.order_id = o.id or (p.order_id is null and ((p.account_id is not null and p.account_id = o.account_id)
        or (p.account_id is null and p.session_id = o.session_id and o.account_id is null))))),
    'amount', public.retained_order_coverage($1, o.id),
    'tip', (select coalesce(sum(a.tip - coalesce(r.tip, 0)), 0) from payment_allocations a
      left join lateral(select sum(tip) tip from refund_allocations where allocation_id = a.id) r on true
      where a.restaurant_id = $1 and a.order_id = o.id))), '[]') value
  from orders o where o.restaurant_id = $1 and o.id = any($2::uuid[])`;
// Every money row the backfill and the historical import can touch.
const MONEY_DIGEST = `select md5(concat_ws('|',
    (select string_agg(md5(t::text), ',' order by t.id) from payments t where restaurant_id = $1),
    (select string_agg(md5(t::text), ',' order by t.id) from payment_allocations t where restaurant_id = $1),
    (select string_agg(md5(t::text), ',' order by t.id) from order_adjustments t where restaurant_id = $1),
    (select string_agg(md5(t::text), ',' order by t.id) from refund_operations t where restaurant_id = $1),
    (select string_agg(md5(t::text), ',' order by t.id) from refund_allocations t where restaurant_id = $1))) value`;

const byId = rows => JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id))
  .map(r => ({ id: r.id, unresolved: r.unresolved, amount: Number(r.amount), tip: Number(r.tip) })));
const value = async (sql, args) => (await db.query(sql, args)).rows[0].value;
let failed = 0;
const fail = (name, message) => { failed++; console.error(`FAIL ${name}: ${message}`); };

try {
  await db.connect();
  const restaurants = (await db.query("select id, name from restaurants order by name, id")).rows;
  for (const r of restaurants) {
    const name = r.name;
    await db.query("begin read only");
    try {
      if (!await value("select to_regprocedure('public.payment_allocations_need_backfill(uuid)') is not null value")) {
        throw new Error("payment_allocations_need_backfill is missing: db:create this branch first");
      }
      const orders = (await db.query("select id from orders where restaurant_id = $1 order by id", [r.id])).rows.map(o => o.id);
      if (await value("select public.payment_allocations_need_backfill($1) value", [r.id])) {
        console.log(`SKIP ${name}: allocations still need a backfill, so the read backfills, as before`);
        continue;
      }
      const expected = byId(await value(OLD_BODY, [r.id, orders]));
      const actual = byId(await value("select public.order_coverage($1, $2::uuid[]) value", [r.id, orders]));
      if (await value("select txid_current_if_assigned() is not null value")) fail(name, "the read was given a transaction id, so it wrote");
      else if (actual !== expected) fail(name, `coverage differs from the old body\n  old ${expected}\n  new ${actual}`);
      else console.log(`PASS ${name}: ${orders.length} orders read inside begin read only, coverage identical`);
    } catch (error) {
      fail(name, error.message.replaceAll("\n", " "));
    } finally {
      await db.query("rollback");
    }
    if (!proveNoop) continue;
    // The old function's own write path, always rolled back.
    await db.query("begin");
    try {
      if (await value("select public.payment_allocations_need_backfill($1) value", [r.id])) continue;
      const before = await value(MONEY_DIGEST, [r.id]);
      await db.query("select public.backfill_payment_allocations($1)", [r.id]);
      if (await value(MONEY_DIGEST, [r.id]) !== before) fail(name, "the skipped backfill would have changed money rows");
      else console.log(`PASS ${name}: the skipped backfill changes no money row`);
    } catch (error) {
      fail(name, error.message.replaceAll("\n", " "));
    } finally {
      await db.query("rollback");
    }
  }
} finally {
  await db.end();
}
if (failed) process.exitCode = 1;
console.log(failed ? `${failed} failed` : "ok");
