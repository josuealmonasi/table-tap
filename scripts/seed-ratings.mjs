// ============================================================================
// TableTap — sample dish ratings
//
//   pnpm db:ratings        seed the development database
//   pnpm db:ratings:prod   seed production
//
// Menus can show a star average, but only once a dish has at least
// MIN_RATINGS_TO_SHOW (3) of them — so with an empty dish_ratings table a demo
// shows no stars at all and "ranked plates" has nothing to rank. This gives
// every restaurant a believable spread: a few clear favourites, a long middle,
// and one or two dishes people didn't love.
//
// Ratings are tied to real orders, exactly as the app requires — the unique
// (order_id, item_id) constraint means one say per dish per visit, so the
// script walks actual paid orders and rates what those orders contained.
//
// Idempotent: it deletes every rating it can attribute to a seeded order
// before inserting, so re-running never doubles up.
// ============================================================================

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isProd = process.argv.includes("--prod");
const envFile = isProd ? ".env.production.local" : ".env.development.local";
const label = isProd ? "production" : "development";

/**
 * A dish's "true" quality, drawn once per dish, then each rating wobbles
 * around it. Flat random noise would give every dish the same ~3.0 average
 * and nothing would rank above anything else.
 */
function qualityFor(i, total) {
  const r = i / Math.max(1, total - 1); // 0 = best, 1 = worst
  if (r < 0.15) return 4.8;
  if (r < 0.4) return 4.4;
  if (r < 0.75) return 3.9;
  if (r < 0.92) return 3.3;
  return 2.6;
}

function ratingAround(quality) {
  const wobble = Math.random() < 0.65 ? 0 : Math.random() < 0.5 ? -1 : 1;
  return Math.min(5, Math.max(1, Math.round(quality) + wobble));
}

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function main() {
  const env = await readFile(join(root, envFile), "utf8");
  const url = env.match(/^DATABASE_URL=(.*)$/m)[1].replace(/^["']|["']$/g, "");
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows: restaurants } = await client.query(
    "select id, name from restaurants order by created_at",
  );
  let total = 0;

  for (const r of restaurants) {
    // Paid orders only: an unpaid order never reached the point where the app
    // would ask the diner what they thought.
    const { rows: orders } = await client.query(
      `select id, items from orders
        where restaurant_id = $1 and paid = true
        order by created_at desc
        limit 400`,
      [r.id],
    );
    const { rows: items } = await client.query(
      `select id from menu_items
        where restaurant_id = $1 and is_addon = false and available
        order by popular desc, price desc`,
      [r.id],
    );
    if (orders.length === 0 || items.length === 0) {
      console.log(`  · ${r.name}: no paid orders or no dishes, skipped`);
      continue;
    }

    const quality = new Map(items.map((it, i) => [it.id, qualityFor(i, items.length)]));
    const known = new Set(items.map(it => it.id));

    await client.query(
      "delete from dish_ratings where restaurant_id = $1 and order_id = any($2)",
      [r.id, orders.map(o => o.id)],
    );

    // Not every diner rates. Roughly two in three orders leave one, and each
    // of those rates a couple of the dishes it contained rather than all.
    const rows = [];
    const seen = new Set();
    for (const order of orders) {
      if (Math.random() > 0.66) continue;
      const lines = Array.isArray(order.items) ? order.items : [];
      const ids = shuffled([
        ...new Set(lines.map(l => l.itemId).filter(id => known.has(id))),
      ]);
      for (const itemId of ids.slice(0, 2)) {
        const key = `${order.id}:${itemId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push([r.id, itemId, order.id, ratingAround(quality.get(itemId))]);
      }
    }

    for (const [rid, itemId, orderId, rating] of rows) {
      await client.query(
        `insert into dish_ratings (restaurant_id, item_id, order_id, rating)
         values ($1, $2, $3, $4)
         on conflict (order_id, item_id) do nothing`,
        [rid, itemId, orderId, rating],
      );
    }

    const {
      rows: [stat],
    } = await client.query(
      `select count(*)::int as rated, count(distinct item_id)::int as dishes
         from dish_ratings where restaurant_id = $1`,
      [r.id],
    );
    total += rows.length;
    console.log(`  · ${r.name}: ${stat.rated} ratings across ${stat.dishes} dishes`);
  }

  console.log(`✓ [${label}] ${restaurants.length} restaurants — ${total} ratings`);
  await client.end();
}

main().catch(err => {
  console.error(`✗ [${label}] failed:`, err.message);
  process.exit(1);
});
