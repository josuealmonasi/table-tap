// Run only against development. Every schema and fixture change is rolled back.
// A short lock timeout avoids waiting behind another developer's database work.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(process.env.DEV_ENV_FILE ?? path.join(root, ".env.development.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const connectionString = process.env.DATABASE_URL ?? "";
if (process.argv.includes("--prod") || process.env.NODE_ENV === "production" || !url || !connectionString
  || `${url} ${connectionString}`.includes("vayymkzrvlepoksualku")
  || !connectionString.includes(new URL(url).hostname.split(".")[0])) throw new Error("Not a verified development database");
const schema = readFileSync(path.join(root, "supabase/schema.sql"), "utf8");
// Pin the schema before this fix so the comparison survives the commit.
const baseline = execFileSync("git", ["show", "3fa40ebb:supabase/schema.sql"], { cwd: root, encoding: "utf8" });
function definition(name, source = schema) {
  const start = source.lastIndexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  return source.slice(start, source.indexOf("$$;", start) + 3);
}
const db = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false }, statement_timeout: 15000 });
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
try {
  await db.connect();
  await db.query("begin");
  await db.query("set local lock_timeout = '1s'");
  await db.query("alter table refund_operations add column if not exists historical_import_reason text");
  for (const name of ["guard_return_money", "import_historical_return", "payment_allocations_need_backfill", "order_coverage"]) {
    await db.query(definition(name, baseline));
  }
  const restaurant = (await one("insert into restaurants(name,plan_status) values('import probe rollback','active') returning id")).id;
  const order = (await one("insert into orders(restaurant_id,status,total,paid) values($1,'cancelled',10,true) returning id", [restaurant])).id;
  await db.query("insert into payments(restaurant_id,order_id,amount,method,stripe_payment_intent) values($1,$2,10,'card','pi_import_probe_rollback')", [restaurant, order]);
  await db.query("insert into user_logs(restaurant_id,actor_email,entity,action,detail) values($1,'probe','order','refunded',$2)",
    [restaurant, `order=${order.slice(0, 8)} amount=10 method=card collector=probe`]);
  const args = [restaurant, [order]];
  const first = (await one("select public.order_coverage($1,$2::uuid[]) as value", args)).value;
  if (!(await one("select public.payment_allocations_need_backfill($1) as value", [restaurant])).value) throw new Error("Baseline did not reproduce the retry");
  for (const name of ["guard_return_money", "import_historical_return", "payment_allocations_need_backfill", "order_coverage"]) {
    await db.query(definition(name));
  }
  const repaired = (await one("select public.order_coverage($1,$2::uuid[]) as value", args)).value;
  if (JSON.stringify(first) !== JSON.stringify(repaired)) throw new Error("Coverage changed while marking the review");
  const review = await one("select status, historical_import_reason from refund_operations where restaurant_id=$1", [restaurant]);
  if (review?.status !== "review" || review.historical_import_reason !== "Historical card return needs provider evidence") throw new Error("Return is not marked for review");
  if ((await one("select public.payment_allocations_need_backfill($1) as value", [restaurant])).value) throw new Error("Second read would enter the backfill");
  // Read-only mode rejects the backfill's SELECT FOR UPDATE. It also proves
  // the second call can run without writing any money row.
  await db.query("set local transaction_read_only = on");
  const second = (await one("select public.order_coverage($1,$2::uuid[]) as value", args)).value;
  if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error("Coverage changed between reads");
  console.log("PASS: baseline needs another import; existing review is marked; next read is read-only and coverage is identical");
} finally {
  await db.query("rollback").catch(() => {});
  await db.end();
}
