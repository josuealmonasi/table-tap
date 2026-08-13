// ============================================================================
// TableTap — production smoke check
//
//   pnpm prod:check
//
// Two questions, because between them they catch the failure that has taken
// the customer menu down twice:
//
//   1. Does production's schema still match dev's? A column that exists in dev
//      and not in prod is invisible until deployed code selects it, at which
//      point every menu falls to its error boundary.
//   2. Does a real customer menu actually render on production right now?
//
// Read-only. Exits non-zero on any difference or failure, so it can gate a
// merge.
// ============================================================================

import pg from "pg";
import { readFile } from "node:fs/promises";

const PROD_MENU =
  process.env.PROD_MENU_URL ??
  "https://table-tap-star.vercel.app/r/2be8e35b-18c5-4be6-bd07-74c82fb8788c";

async function envFrom(file) {
  const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  return Object.fromEntries(
    text
      .split("\n")
      .filter(l => l.includes("=") && !l.trim().startsWith("#"))
      .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
}

const QUERIES = {
  columns: `select table_name || '.' || column_name as k from information_schema.columns
            where table_schema = 'public' order by 1`,
  anonGrants: `select table_name || '.' || column_name as k
               from information_schema.column_privileges
               where grantee = 'anon' and privilege_type = 'SELECT' order by 1`,
  tables: `select tablename as k from pg_tables where schemaname = 'public' order by 1`,
  functions: `select proname as k from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' order by 1`,
  policies: `select tablename || ': ' || policyname as k from pg_policies
             where schemaname = 'public' order by 1`,
};

async function snapshot(connectionString) {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const out = {};
  for (const [name, sql] of Object.entries(QUERIES)) {
    out[name] = (await client.query(sql)).rows.map(r => r.k);
  }
  await client.end();
  return out;
}

let failed = false;

const [dev, prod] = await Promise.all([
  envFrom(".env.development.local").then(e => snapshot(e.DATABASE_URL)),
  envFrom(".env.production.local").then(e => snapshot(e.DATABASE_URL)),
]);

console.log("Schema: dev vs production\n");
for (const name of Object.keys(QUERIES)) {
  const missing = dev[name].filter(x => !prod[name].includes(x));
  const extra = prod[name].filter(x => !dev[name].includes(x));
  if (missing.length === 0 && extra.length === 0) {
    console.log(`  ok       ${name} (${dev[name].length})`);
    continue;
  }
  failed = true;
  console.log(`  DIFFERS  ${name}`);
  if (missing.length) console.log(`             missing in prod: ${missing.join(", ")}`);
  if (extra.length) console.log(`             only in prod:    ${extra.join(", ")}`);
}

console.log("\nProduction customer menu\n");
try {
  const res = await fetch(PROD_MENU, { headers: { "accept-language": "es-MX" } });
  const html = await res.text();
  // The error boundary renders this instead of the menu when a query throws.
  const brokeSpanish = html.includes("No pudimos cargar el men");
  const brokeEnglish = html.includes("couldn&#x27;t load the menu");
  const hasDishes = html.includes("tt-item");

  if (res.status !== 200 || brokeSpanish || brokeEnglish || !hasDishes) {
    failed = true;
    console.log(`  FAILED   status ${res.status}`);
    if (brokeSpanish || brokeEnglish) console.log("           the menu is showing its error page");
    if (!hasDishes) console.log("           no dishes in the response");
  } else {
    console.log(`  ok       status 200, dishes rendered`);
  }
} catch (err) {
  failed = true;
  console.log(`  FAILED   ${err.message}`);
}

console.log(
  failed
    ? "\nProduction is NOT in step with dev. Apply the migration before merging.\n"
    : "\nProduction is healthy and in step with dev.\n",
);
process.exit(failed ? 1 : 0);
