// ============================================================================
// TableTap — does the demo data still look like the app?
//
// The seeder is written once and the schema keeps moving. A column added later
// is not a syntax error in `mock-data.mjs`; it is a column the demo silently
// leaves null, and the first thing that notices is a gate failing on a clean
// checkout — which is exactly how `pnpm money` came to complain about cash
// payments with nobody named.
//
//   pnpm seed:shape          (dev)
//   pnpm seed:shape --prod
// ============================================================================
import { join } from "node:path";
import pg from "pg";

const prod = process.argv.includes("--prod");
process.loadEnvFile(join(process.cwd(), prod ? ".env.production.local" : ".env.development.local"));
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

let failed = 0;
const ok = m => console.log(`    ok       ${m}`);
const bad = m => { failed++; console.log(`    THIN     ${m}`); };
const note = m => console.log(`    ..       ${m}`);

console.log(`\nSeed shape — ${prod ? "production" : "development"}\n`);

// Columns the app reads and reasons about. A demo that leaves these null shows
// a screen no real restaurant would ever see, and hides the bugs that live
// where the value is present.
const EXPECT = {
  restaurants: ["timezone", "tax_pct", "service_pct", "plan", "plan_status", "terms_version",
                "accepting_orders", "deals_tab_enabled", "auto_print_kitchen"],
  menu_items:  ["dietary", "modifiers", "discount_pct", "emoji", "available", "skips_kitchen"],
  menus:       ["schedule", "active", "sort_order"],
  orders:      ["items", "status", "paid", "pay_method", "total", "subtotal", "service_fee",
                "tip", "tax_pct", "session_id", "table_label"],
  payments:    ["method", "amount", "actor_email", "order_id"],
  promotions:  ["kind", "active", "emoji"],
  staff:       ["role", "user_id"],
};

const { rows: cols } = await c.query(`
  select table_name, column_name from information_schema.columns where table_schema='public'`);
const has = new Set(cols.map(r => `${r.table_name}.${r.column_name}`));

for (const [table, expected] of Object.entries(EXPECT)) {
  const { rows: [t] } = await c.query(`select count(*)::int n from ${table}`);
  if (t.n === 0) { note(`${table}: no rows at all — nothing to judge`); continue; }
  const thin = [];
  const gone = [];
  for (const col of expected) {
    if (!has.has(`${table}.${col}`)) { gone.push(col); continue; }
    const { rows: [r] } = await c.query(
      `select count(*)::int filled from ${table} where ${col} is not null`);
    if (r.filled === 0) thin.push(col);
  }
  if (gone.length) bad(`${table}: the check names columns the schema no longer has — ${gone.join(", ")}`);
  if (thin.length) bad(`${table}: every row leaves ${thin.join(", ")} null`);
  if (!gone.length && !thin.length) ok(`${table} (${t.n} rows) carries every column the app reads`);
}

// A few shapes the app depends on beyond "not null".
const { rows: [cash] } = await c.query(
  `select count(*)::int n from payments where method='cash' and actor_email is null`);
cash.n === 0 ? ok("every cash payment names who took it")
             : bad(`${cash.n} cash payment(s) name nobody — the corte cannot be built from that`);

const { rows: [sched] } = await c.query(
  `select count(*)::int n from menus where schedule is not null and schedule::text <> 'null'`);
sched.n > 0 ? ok(`${sched.n} menu(s) carry a schedule — the open/closed paths are exercised`)
            : note("no menu carries a schedule — menu-hours logic is never seen in the demo");

const { rows: [stock] } = await c.query(
  `select count(*)::int n from menu_items where stock is not null`);
stock.n > 0 ? ok(`${stock.n} dish(es) count stock — inventory is exercised`)
            : note("no dish counts stock — the inventory paths are never seen in the demo");

const { rows: [combos] } = await c.query(`select count(*)::int n from promotions where kind='combo'`);
combos.n > 0 ? ok(`${combos.n} combo(s) — bundle pricing is exercised`)
             : note("no combos — bundle pricing is never seen in the demo");

console.log(failed === 0 ? "\nThe demo looks like the app.\n" : `\n${failed} PROBLEM(S).\n`);
await c.end();
process.exit(failed === 0 ? 0 : 1);
