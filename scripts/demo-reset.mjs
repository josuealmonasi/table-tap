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
import pg from "pg";
import { seedMock } from "./mock-data.mjs";

const only = process.argv.find(a => a === "--dev" || a === "--prod");
const targets = [
  ["development", ".env.development.local"],
  ["production", ".env.production.local"],
].filter(([name]) => !only || only.slice(2) === name.slice(0, only.length - 2));

function envFrom(file) {
  const out = {};
  for (const line of readFileSync(join(process.cwd(), file), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

for (const [name, file] of targets) {
  const env = envFrom(file);
  // seedMock reads the service key from the environment to create the logins.
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
    console.log(`✓ [${name}] ${out.orders} pedidos · ${out.products} platillos`);
    console.log(`  menú: /r/${out.restaurantId}/t/${out.tableId}`);
  } finally {
    await client.end();
  }
}

console.log("\nDemo Bistro rebuilt. Logins: demo@tabletap.dev / demo123\n");
