// Run before and after applying schema.sql, with no fixture reset between runs:
// node --env-file=.env.development.local scripts/probe-orders-rls-equivalence.mjs > /tmp/orders-before.json
// node --env-file=.env.development.local scripts/probe-orders-rls-equivalence.mjs --compare /tmp/orders-before.json
// This opens no app, signs nobody in and never writes to the database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const tables = ["orders", "service_requests", "kitchen_tickets", "kitchen_requests"];
const demo = ["demo@tabletap.dev", "demo-manager@tabletap.dev", "demo-cashier@tabletap.dev",
  "demo-waiter@tabletap.dev", "demo-kitchen@tabletap.dev"];
const unassigned = "00000000-0000-0000-0000-000000000001";
/** @typedef {{ count: number, fingerprint: string }} RowCount */

export function developmentConfig(env, args) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "", connectionString = env.DATABASE_URL ?? "";
  if (args.includes("--prod") || env.NODE_ENV === "production" || !url || !connectionString
    || `${url} ${connectionString}`.includes("vayymkzrvlepoksualku")) {
    throw new Error("Refusing to probe production or an unknown database");
  }
  const project = new URL(url).hostname.split(".")[0];
  if (!connectionString.includes(project)) throw new Error("Development project and SQL connection differ");
  return { connectionString, ssl: { rejectUnauthorized: false }, statement_timeout: 15000, connectionTimeoutMillis: 10000 };
}

/** @returns {Promise<RowCount>} */
async function tableRows(db, table) {
  // Names come only from the fixed allowlist above, never from a command argument.
  const { rows: [row] } = await db.query(`select count(*)::int as count,
    md5(coalesce(string_agg(id::text || ':' || restaurant_id::text, ',' order by id), '')) as fingerprint
    from public.${table}`);
  return row;
}

async function visibleRows(db, actor, explain, restaurant) {
  await db.query("savepoint actor");
  try {
    await db.query(`set local role ${actor.role === "anon" ? "anon" : "authenticated"}`);
    // Clear legacy claim GUCs too: a pooled session must not lend us its last user.
    await db.query(`select set_config('request.jwt.claim.sub', $1, true),
      set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)`,
    [actor.id ?? "", actor.role, JSON.stringify({ sub: actor.id, role: actor.role })]);
    const { rows: [identity] } = await db.query("select current_user as role, auth.uid()::text as id");
    assert.deepEqual(identity, { role: actor.role, id: actor.id }, "RLS must run as this actor, never as postgres");
    /** @type {Record<string, RowCount | { denied: boolean }>} */
    const visible = {};
    for (const table of tables) {
      const { rows: [grant] } = await db.query("select has_table_privilege(current_user, $1, 'SELECT') as allowed", [`public.${table}`]);
      visible[table] = grant.allowed ? await tableRows(db, table) : { denied: true };
    }
    let plan;
    if (explain && actor.role === "authenticated") {
      const result = await db.query(`explain (analyze, buffers, format json)
        select id from public.orders where restaurant_id = $1
        order by created_at desc limit 10`, [restaurant]);
      plan = result.rows[0]["QUERY PLAN"];
    }
    return { actor, visible, ...(plan ? { plan } : {}) };
  } finally {
    await db.query("rollback to savepoint actor");
    await db.query("release savepoint actor");
  }
}

export async function captureOrdersAccess(db, explain = false) {
  await db.query("begin isolation level repeatable read read only");
  try {
    const { rows: flags } = await db.query(`select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any($1::text[]) order by c.relname`, [tables]);
    assert.equal(flags.length, tables.length, "All four tables must exist");
    assert.ok(flags.every(row => row.relrowsecurity), "All four tables must enforce RLS");
    const { rows: policies } = await db.query(`select tablename, policyname, roles, cmd, qual, with_check
      from pg_policies where schemaname = 'public' and tablename = any($1::text[])
      order by tablename, policyname`, [tables]);
    const { rows: users } = await db.query(`select id::text, email from auth.users where email = any($1::text[]) order by email`, [demo]);
    assert.deepEqual(users.map(u => u.email).sort(), [...demo].sort(), "All five demo logins must exist");
    const { rows: [identity] } = await db.query("select exists(select 1 from auth.users where id = $1) as present", [unassigned]);
    assert.equal(identity.present, false, "The unassigned identity must not be a real login");
    const { rows: [restaurant] } = await db.query(`select r.id from public.restaurants r
      join auth.users u on u.id = r.owner_id where u.email = $1 order by r.id limit 1`, [demo[0]]);
    assert.ok(restaurant, "The demo owner must own a restaurant");
    const { rows: extra } = await db.query(`select distinct u.id::text, u.email from auth.users u
      where exists(select 1 from public.platform_admins a where a.user_id = u.id)
        or exists(select 1 from public.staff s where s.user_id = u.id and s.role = 'owner')
      order by u.email`);
    const { rows: [membership] } = await db.query(`select md5(jsonb_build_array(
      (select jsonb_agg(jsonb_build_array(id, owner_id) order by id) from public.restaurants),
      (select jsonb_agg(jsonb_build_array(restaurant_id, user_id, role) order by restaurant_id, user_id) from public.staff),
      (select jsonb_agg(user_id order by user_id) from public.platform_admins))::text) as fingerprint`);
    /** @type {Record<string, RowCount>} */
    const dataset = {};
    for (const table of tables) dataset[table] = await tableRows(db, table);
    const actors = [...new Map([...users, ...extra].map(u => [u.id, { ...u, role: "authenticated" }])).values(),
      { id: unassigned, email: "unassigned probe identity", role: "authenticated" },
      { id: null, email: "authenticated without a subject", role: "authenticated" },
      { id: null, email: "anon diner", role: "anon" }];
    const results = [];
    for (const actor of actors) results.push(await visibleRows(db, actor, explain, restaurant.id));
    return { dataset, membership, policies, results,
      coverage: { platformAdminsAndCoOwners: extra.length, note: "Missing live role variants remain covered by the unit matrix." } };
  } finally {
    await db.query("rollback");
  }
}

export function compareOrdersAccess(before, after) {
  // Counts alone can hide one tenant's row replacing another's. Compare IDs too.
  assert.deepEqual(after.dataset, before.dataset, "Fixtures changed; capture the baseline again");
  assert.deepEqual(after.membership, before.membership, "Membership changed; capture the baseline again");
  const rows = snapshot => snapshot.results.map(({ actor, visible }) => ({ actor, visible }));
  assert.deepEqual(rows(after), rows(before), "Visible rows changed under RLS");
}

async function main() {
  if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env.development.local"));
  const args = process.argv.slice(2), compare = args.indexOf("--compare");
  if (compare >= 0 && !args[compare + 1]) throw new Error("--compare needs the baseline JSON file");
  const db = new pg.Client(developmentConfig(process.env, args));
  try {
    await db.connect();
    const snapshot = await captureOrdersAccess(db, args.includes("--explain"));
    if (compare >= 0) compareOrdersAccess(JSON.parse(readFileSync(args[compare + 1], "utf8")), snapshot);
    console.log(JSON.stringify(snapshot, null, 2));
  } finally {
    await db.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
