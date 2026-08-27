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

// Which menu to prod. A hardcoded id survives right up until production data
// is reseeded, and then this check reports a 404 that says nothing about
// whether production works — it says the id moved. Resolved from the database
// instead, so it keeps checking a real menu whatever the ids are.
const PROD_SITE = process.env.PROD_SITE_URL ?? "https://table-tap-star.vercel.app";

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
  // Scoped to our own schema. Without the filter it also compared Supabase's
  // `storage` schema, which updates itself per project: production got new
  // columns before development and the check screamed about a drift nobody
  // could fix. And a false alarm here is expensive, because it hides the real
  // one — column grants are exactly what separates one restaurant from
  // another.
  anonGrants: `select table_name || '.' || column_name as k
               from information_schema.column_privileges
               where grantee = 'anon' and privilege_type = 'SELECT'
                 and table_schema = 'public' order by 1`,
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

/**
 * A restaurant that is actually serving something, straight from production.
 *
 * Picks one with an active menu holding at least one available dish, so a
 * green tick means a diner could really order — not merely that some URL
 * returned 200.
 */
async function liveMenuUrl() {
  const env = await envFrom(".env.production.local");
  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const { rows } = await client.query(`
    select r.id
      from restaurants r
      join menus m on m.restaurant_id = r.id and m.active
      join categories c on c.menu_id = m.id
      join menu_items i on i.category_id = c.id and i.available
     group by r.id
     order by count(i.id) desc
     limit 1
  `);
  await client.end();
  return rows[0] ? `${PROD_SITE}/r/${rows[0].id}` : null;
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
  const menuUrl = await liveMenuUrl();
  if (!menuUrl) {
    console.log("  SKIPPED  no restaurant with an active menu to check");
    process.exit(failed ? 1 : 0);
  }
  const res = await fetch(menuUrl, { headers: { "accept-language": "es-MX" } });
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

// ── Logins, in both environments ────────────────────────────────────────────
// Dev is not a scratch pad: a broken dev database costs a morning of chasing
// a bug that is not in the code. This broke once by resetting dev and only
// re-seeding the demo data on production, which nothing noticed until someone
// signed in and found no restaurant.
const LOGINS = [
  "demo@tabletap.dev",
  "demo-manager@tabletap.dev",
  "demo-waiter@tabletap.dev",
  "demo-cashier@tabletap.dev",
  "demo-kitchen@tabletap.dev",
  "test1@tabletap.dev",
  "test2@tabletap.dev",
  "test3@tabletap.dev",
  "test4@tabletap.dev",
  "test5@tabletap.dev",
];

async function checkLogins(label, envFile) {
  const env = await envFrom(envFile);
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
  const ids = Object.fromEntries((users?.users ?? []).map(u => [u.email, u.id]));
  const { data: restaurants } = await db.from("restaurants").select("id, name, owner_id");
  const { data: staff } = await db.from("staff").select("email, restaurant_id");

  const broken = LOGINS.filter(email => {
    const uid = ids[email];
    if (!uid) return true;
    // An owner is linked by restaurants.owner_id; everyone else by a staff row.
    return (
      !(restaurants ?? []).some(r => r.owner_id === uid) &&
      !(staff ?? []).some(m => m.email === email)
    );
  });

  if (broken.length > 0) {
    failed = true;
    console.log(`  FAILED   ${label}: no restaurant for ${broken.join(", ")}`);
  } else {
    console.log(`  ok       ${label}: all ${LOGINS.length} logins resolve`);
  }
}

console.log("\nLogins\n");
try {
  await checkLogins("development", ".env.development.local");
  await checkLogins("production", ".env.production.local");
} catch (err) {
  failed = true;
  console.log(`  FAILED   ${err.message}`);
}

console.log(
  failed
    ? "\nSomething is off. Fix it before merging.\n"
    : "\nDev and production are healthy and in step.\n",
);
process.exit(failed ? 1 : 0);
