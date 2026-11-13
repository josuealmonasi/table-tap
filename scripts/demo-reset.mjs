// ============================================================================
// TableTap — "reset data in dev and prod"
//
// Rebuilds the Demo Bistro data in BOTH environments from scratch, so the demo
// always looks like a restaurant that has been open for two months. Touches
// nothing else: the base seed (Sakura, test1..5) and any real restaurant are
// left exactly as they are.
//
//   pnpm demo:reset            both environments
//   pnpm demo:reset --dev      just development
//   pnpm demo:reset --prod     just production
// ============================================================================
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import pg from "pg";
import { seedMock } from "./mock-data.mjs";
import { loginSecret } from "./login-secrets.mjs";

const only = process.argv.find(a => a === "--dev" || a === "--prod");
const targets = [
  ["development", ".env.development.local"],
  ["production", ".env.production.local"],
].filter(([name]) => !only || only.slice(2) === name.slice(0, only.length - 2));

function envFrom(file) {
  return parseEnv(readFileSync(join(process.cwd(), file), "utf8"));
}

for (const [name, file] of targets) {
  const env = envFrom(file);
  // seedMock reads the service key and password from the target environment
  // to create the logins. Never carry the first target's password into the next.
  process.env.DEMO_PASSWORD = loginSecret("DEMO_PASSWORD", env, file);
  process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;

  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`\n▸ [${name}] rebuilding Demo Bistro…`);
  try {
    const out = await seedMock(client);
    console.log(`✓ [${name}] ${out.orders} order(s) · ${out.products} dish(es)`);
    console.log(`  menu: /r/${out.restaurantId}/t/${out.tableId}`);
  } finally {
    await client.end();
  }
}

console.log("\nDemo Bistro rebuilt. Login: demo@tabletap.dev; DEMO_PASSWORD is in each target's env file.\n");
