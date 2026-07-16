// ============================================================================
// TableTap — database management runner
//
//   Dev (default → .env.development.local):
//     pnpm db:create   create tables / RLS / realtime (structure only)
//     pnpm db:seed     insert demo data + create test logins (test1..5@tabletap.dev)
//     pnpm db:reset    drop + create + seed (fresh start)
//     pnpm db:drop     drop all tables
//     pnpm db:purge    empty all tables (keep structure)
//
//   Prod (append :prod → .env.production.local):
//     pnpm db:create:prod   pnpm db:seed:prod   pnpm db:reset:prod   ...
//
// Picks the database from DATABASE_URL in the matching env file. Destructive
// commands against production require typing "production" to confirm.
// ============================================================================

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import pg from "pg";
import {
  ensurePlatformAdmin,
  seedTeamLogins,
  seedTestUsers,
  TEST_PASSWORD,
} from "./test-users.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Each command maps to the ordered list of SQL files it runs.
const COMMANDS = {
  create: {
    files: ["supabase/schema.sql"],
    label: "Creating schema",
    destructive: false,
  },
  seed: { files: ["supabase/seed.sql"], label: "Seeding demo data", destructive: false },
  drop: { files: ["supabase/drop.sql"], label: "Dropping all tables", destructive: true },
  purge: {
    files: ["supabase/purge.sql"],
    label: "Emptying all tables",
    destructive: true,
  },
  reset: {
    files: ["supabase/drop.sql", "supabase/schema.sql", "supabase/seed.sql"],
    label: "Resetting (drop + create + seed)",
    destructive: true,
  },
};

const command = process.argv[2];
const isProd = process.argv.includes("--prod");
const target = isProd ? "production" : "development";
const envFile = isProd ? ".env.production.local" : ".env.development.local";

const config = COMMANDS[command];
if (!config) {
  console.error(`✗ Unknown command "${command ?? ""}".`);
  console.error(
    "  Use: create | seed | reset | drop | purge   (add --prod for production)",
  );
  process.exit(1);
}

// Load the target environment's variables (Node 20.12+/21.7+).
try {
  process.loadEnvFile(join(root, envFile));
} catch {
  console.error(`✗ Could not read ${envFile}.`);
  console.error(`  Create it (copy ${envFile}.example) and fill in DATABASE_URL.`);
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(`✗ DATABASE_URL is not set in ${envFile}.`);
  console.error("  Supabase → Connect → 'Session pooler' URI, with your DB password.");
  process.exit(1);
}

// Safety gate: typing-confirmation before destructive production changes.
if (isProd && config.destructive) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `⚠️  About to ${command.toUpperCase()} the PRODUCTION database. Type "production" to continue: `,
  );
  rl.close();
  if (answer.trim() !== "production") {
    console.error("Aborted.");
    process.exit(1);
  }
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

console.log(`▸ [${target}] ${config.label}…`);

try {
  await client.connect();
  for (const file of config.files) {
    const sql = await readFile(join(root, file), "utf8");
    await client.query(sql);
  }

  // After seed/reset: re-link the test logins, then report what's ready.
  // This runs on dev AND prod (a test prod): a reset wipes restaurants/staff
  // but not auth.users, so seeding must heal those links or every surviving
  // login lands on "No restaurant linked to this account".
  if (command === "seed" || command === "reset") {
    const testEmails = await seedTestUsers(client);
    const teamReady = await seedTeamLogins(client);

    // The platform admin is infrastructure — ensure it on dev AND prod.
    const adminEmail = await ensurePlatformAdmin(client);
    if (adminEmail) console.log(`  Platform admin ready: ${adminEmail}`);
    if (teamReady.length) console.log(`  Team logins: ${teamReady.join(", ")}`);

    const { rows: restaurants } = await client.query(
      "select id, name from restaurants order by created_at",
    );
    const { rows: tables } = await client.query(
      "select id, label from restaurant_tables order by label::int limit 1",
    );

    console.log(`\n✓ [${target}] Done. ${restaurants.length} restaurant(s).`);
    if (restaurants.length && tables.length) {
      console.log(
        `  Demo menu: http://localhost:3000/r/${restaurants[0].id}/t/${tables[0].id}`,
      );
    }
    if (testEmails.length) {
      console.log(`\n  Test logins at /login (password: ${TEST_PASSWORD}):`);
      for (const email of testEmails) console.log(`    ${email}`);
    }
  } else {
    console.log(`✓ [${target}] Done.`);
  }
} catch (err) {
  console.error(`\n✗ [${target}] ${command} failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
