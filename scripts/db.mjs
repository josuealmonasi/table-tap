// ============================================================================
// TableTap — database management runner
//
//   pnpm seed             → create schema + seed demo data (safe to re-run)
//   pnpm database:drop    → drop all tables (structure + data)
//   pnpm database:purge   → empty all tables (keep structure)
//
// Connects to your Supabase Postgres via DATABASE_URL and executes the matching
// SQL file in supabase/. The package.json scripts pass `--env-file=.env.local`,
// so DATABASE_URL is read from there automatically.
// ============================================================================

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const COMMANDS = {
  seed: { file: "supabase/schema.sql", label: "Creating schema + seeding demo data" },
  drop: { file: "supabase/drop.sql", label: "Dropping all tables" },
  purge: { file: "supabase/purge.sql", label: "Emptying all tables" },
};

const command = process.argv[2];
const config = COMMANDS[command];

if (!config) {
  console.error(`✗ Unknown command "${command ?? ""}".`);
  console.error("  Use one of: pnpm seed | pnpm database:drop | pnpm database:purge");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("✗ DATABASE_URL is not set in .env.local.");
  console.error("  Get it from Supabase → Connect (top bar) → 'Session pooler' URI,");
  console.error("  paste your database password into it, then add it to .env.local as DATABASE_URL.");
  process.exit(1);
}

const sql = await readFile(join(root, config.file), "utf8");

// Supabase requires SSL; rejectUnauthorized:false avoids needing the CA locally.
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

console.log(`▸ ${config.label}…`);

try {
  await client.connect();
  await client.query(sql);

  if (command === "seed") {
    const { rows: restaurants } = await client.query(
      "select id, name from restaurants order by created_at"
    );
    const { rows: tables } = await client.query(
      "select id, label from restaurant_tables order by label::int"
    );

    if (restaurants.length && tables.length) {
      const r = restaurants[0];
      const t = tables[0];
      console.log(`\n✓ Done. ${restaurants.length} restaurant(s), ${tables.length} table(s).`);
      console.log(`  Demo restaurant "${r.name}" → ${r.id}`);
      console.log(`\n  Open the customer menu at:`);
      console.log(`  http://localhost:3000/r/${r.id}/t/${t.id}`);
    } else {
      console.log("✓ Done.");
    }
  } else {
    console.log("✓ Done.");
  }
} catch (err) {
  console.error(`\n✗ ${command} failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
