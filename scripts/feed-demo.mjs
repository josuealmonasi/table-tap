// ============================================================================
// pnpm feed-demo            — the presentation restaurant on development
// pnpm feed-demo:prod       — the same on production (asks you to type "Demo Bistro")
//
// Rebuilds Demo Bistro as a restaurant that has been open for two months, for
// showing a prospect every role and workflow: the menu at Mexican prices, ~60
// days of orders up to today, a recipe for every dish but two (so Costs shows
// a margin per product and the "no recipe" warning), weekly supplier
// deliveries, waste, a closed register shift every day, accounts, the visit
// card, promotions and coupons — and one login per role.
//
// Only Demo Bistro and its five demo logins are deleted and rebuilt; the
// seeder refuses anything else. Prices: DEMO_PRICE_SCALE (default 15 here).
// Password: DEMO_PASSWORD from the target env file, required before rebuilding.
// ============================================================================
import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import pg from "pg";
import { loginSecret } from "./login-secrets.mjs";

const isProd = process.argv.includes("--prod");
const envFile = isProd ? ".env.production.local" : ".env.development.local";
process.loadEnvFile(join(process.cwd(), envFile));

// The env file is only a claim about where it points. Production's project
// is named by its own file: a development run must not reach it, and a
// production run must reach nothing else (a dev file holding production
// credentials once would have rebuilt production without asking).
function projectRef(url) {
  return url?.match(/([a-z0-9]{20})\.supabase\.co/)?.[1] ?? url?.match(/postgres\.([a-z0-9]{20})[:@]/)?.[1] ?? null;
}
let prodRef = null;
try {
  prodRef = projectRef(parseEnv(readFileSync(join(process.cwd(), ".env.production.local"), "utf8")).NEXT_PUBLIC_SUPABASE_URL);
} catch { /* no production file on this machine: nothing to confuse it with */ }
const target = process.env.DATABASE_URL ?? "";
const reachesProd = Boolean(prodRef && (target.includes(prodRef) || projectRef(process.env.NEXT_PUBLIC_SUPABASE_URL) === prodRef));
if (isProd ? !reachesProd : reachesProd) {
  console.error(isProd
    ? `refusing: ${envFile} does not point at the production project`
    : `refusing: ${envFile} points at the production project; use pnpm feed-demo:prod`);
  process.exit(1);
}
process.env.FEED_DEMO = "1";
process.env.DEMO_PRICE_SCALE ??= "15";

// Imported after the env is set: the seeders read it when they load.
const { seedMock, DEMO_OWNER, DEMO_TEAM, DEMO_RESTAURANT } = await import("./mock-data.mjs");
const { seedHistory } = await import("./mock-history.mjs");

if (isProd) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`⚠️  This deletes and rebuilds "${DEMO_RESTAURANT}" on PRODUCTION. Type its name to continue: `);
  rl.close();
  if (answer.trim() !== DEMO_RESTAURANT) { console.error("Aborted."); process.exit(1); }
}
loginSecret("DEMO_PASSWORD");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  // The seeder deletes restaurants by name. Every one with this name must be
  // the demo owner's, or a customer who called theirs the same would be gone.
  const { rows: others } = await client.query(
    `select r.id, u.email from restaurants r left join auth.users u on u.id = r.owner_id
      where r.name = $1 and u.email is distinct from $2`, [DEMO_RESTAURANT, DEMO_OWNER.email]);
  if (others.length) {
    throw new Error(`refusing: ${others.length} restaurant(s) named "${DEMO_RESTAURANT}" belong to someone else (${others.map(o => o.id).join(", ")})`);
  }
  const summary = await seedMock(client);
  const history = await seedHistory(client, summary.restaurantId);
  const { rows: [counts] } = await client.query(
    `select (select count(*) from orders where restaurant_id = $1) orders,
            (select count(*) from menu_items where restaurant_id = $1 and not is_addon) dishes,
            (select count(distinct item_id) from recipe_lines where restaurant_id = $1) recipes,
            (select count(*) from ingredients where restaurant_id = $1) ingredients,
            (select count(*) from cash_shifts where restaurant_id = $1) shifts,
            (select min(created_at)::date || ' → ' || max(created_at)::date from orders where restaurant_id = $1) span`,
    [summary.restaurantId]);
  console.log(`\n✓ [${isProd ? "production" : "development"}] ${DEMO_RESTAURANT} ready`);
  console.log(`  ${counts.orders} orders (${counts.span}), ${counts.dishes} dishes, ${counts.recipes} with a recipe,`);
  console.log(`  ${counts.ingredients} ingredients, ${history.deliveries} deliveries, ${history.waste} waste entries, ${counts.shifts} register shifts`);
  console.log(`\n  Logins (DEMO_PASSWORD in ${envFile}):`);
  console.log(`    ${DEMO_OWNER.email}   owner`);
  for (const t of DEMO_TEAM) console.log(`    ${t.email}   ${t.role}`);
  console.log(`\n  Next: pnpm money${isProd ? ":prod" : ""} and pnpm smoke${isProd ? ":prod" : ""}.`);
} finally {
  await client.end();
}
