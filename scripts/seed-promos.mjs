// ============================================================================
// TableTap — sample promotions, coupons and item discounts
//
//   pnpm db:promos        seed the development database
//   pnpm db:promos:prod   seed production
//
// Gives every promotion type real data to look at: a combo, a 2x1, tiered
// pricing, item sale prices, and coupons covering percent / fixed / limited
// uses / minimum spend / scheduled windows.
//
// Idempotent — it removes the rows it created before inserting them again, so
// re-running never piles up duplicates and never touches hand-made data.
// ============================================================================

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isProd = process.argv.includes("--prod");
const envFile = isProd ? ".env.production.local" : ".env.development.local";
const label = isProd ? "production" : "development";

/** Marker so a re-run only ever clears rows this script made. */
const TAG = "[sample]";

const COUPONS = [
  { code: "WEL-10P", kind: "percent", value: 10, max_uses: null, min_subtotal: 0 },
  { code: "SAV-25P", kind: "percent", value: 25, max_uses: 100, min_subtotal: 0 },
  { code: "FIV-OFF", kind: "fixed", value: 5, max_uses: null, min_subtotal: 0 },
  { code: "BIG-200", kind: "fixed", value: 30, max_uses: null, min_subtotal: 200 },
  { code: "LIM-005", kind: "percent", value: 15, max_uses: 5, min_subtotal: 0 },
  { code: "SPE-NT1", kind: "percent", value: 20, max_uses: 50, min_subtotal: 0, days: [-3, 14] },
  { code: "SOO-N01", kind: "percent", value: 30, max_uses: 25, min_subtotal: 0, days: [7, 30] },
  { code: "OLD-EXP", kind: "percent", value: 50, max_uses: 10, min_subtotal: 0, days: [-30, -1] },
];

async function main() {
  const env = await readFile(join(root, envFile), "utf8");
  const url = env.match(/^DATABASE_URL=(.*)$/m)[1].replace(/^["']|["']$/g, "");
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const { rows: restaurants } = await client.query(
    "select id, name, currency from restaurants order by created_at",
  );
  if (restaurants.length === 0) {
    console.log(`▸ [${label}] no restaurants — nothing to seed.`);
    await client.end();
    return;
  }

  let totals = { combos: 0, bogo: 0, tiered: 0, coupons: 0, discounts: 0 };

  for (const r of restaurants) {
    // Products this restaurant can actually promote, cheapest first so the
    // combo maths stay sensible whatever the menu looks like.
    const { rows: products } = await client.query(
      `select id, name, price from menu_items
        where restaurant_id = $1 and is_addon = false and available
        order by price asc`,
      [r.id],
    );
    if (products.length < 3) {
      console.log(`  · ${r.name}: only ${products.length} products, skipped`);
      continue;
    }

    // ── clean up previous runs ────────────────────────────────────────────
    await client.query("delete from promotions where restaurant_id = $1 and name like $2", [
      r.id,
      `%${TAG}`,
    ]);
    await client.query(
      "delete from coupon_redemptions where restaurant_id = $1 and code = any($2)",
      [r.id, COUPONS.map(c => c.code)],
    );
    await client.query("delete from coupons where restaurant_id = $1 and code = any($2)", [
      r.id,
      COUPONS.map(c => c.code),
    ]);

    // ── combo: three cheapest items bundled at ~75% of their total ────────
    const bundle = products.slice(0, 3);
    const regular = bundle.reduce((s, p) => s + Number(p.price), 0);
    const comboPrice = Math.max(1, Math.round(regular * 0.75 * 100) / 100);
    const { rows: [combo] } = await client.query(
      `insert into promotions (restaurant_id, kind, name, emoji, description, combo_price)
       values ($1,'combo',$2,'🌮',$3,$4) returning id`,
      [r.id, `Meal Deal ${TAG}`, "Three favourites at one price", comboPrice],
    );
    for (const p of bundle) {
      await client.query(
        "insert into promotion_items (promotion_id, item_id, qty) values ($1,$2,1)",
        [combo.id, p.id],
      );
    }
    totals.combos++;

    // ── 2x1 on the most expensive item ───────────────────────────────────
    const priciest = products[products.length - 1];
    const { rows: [bogo] } = await client.query(
      `insert into promotions (restaurant_id, kind, name, emoji, buy_qty, pay_qty)
       values ($1,'bogo',$2,'🏷️',2,1) returning id`,
      [r.id, `2x1 ${priciest.name} ${TAG}`],
    );
    await client.query(
      "insert into promotion_items (promotion_id, item_id, qty) values ($1,$2,1)",
      [bogo.id, priciest.id],
    );
    totals.bogo++;

    // ── tiered: 1 at full price, 2 for 15% off, 4 for 25% off ────────────
    const cheap = products[0];
    const unit = Number(cheap.price);
    const tiers = [
      { qty: 1, price: Math.round(unit * 100) / 100 },
      { qty: 2, price: Math.round(unit * 2 * 0.85 * 100) / 100 },
      { qty: 4, price: Math.round(unit * 4 * 0.75 * 100) / 100 },
    ];
    const { rows: [tiered] } = await client.query(
      `insert into promotions (restaurant_id, kind, name, emoji, tiers)
       values ($1,'tiered',$2,'🔖',$3::jsonb) returning id`,
      [r.id, `${cheap.name} multi-buy ${TAG}`, JSON.stringify(tiers)],
    );
    await client.query(
      "insert into promotion_items (promotion_id, item_id, qty) values ($1,$2,1)",
      [tiered.id, cheap.id],
    );
    totals.tiered++;

    // ── item sale prices on two products ─────────────────────────────────
    const onSale = [products[1], products[Math.floor(products.length / 2)]].filter(Boolean);
    for (const [i, p] of onSale.entries()) {
      await client.query("update menu_items set discount_pct = $1 where id = $2", [
        i === 0 ? 20 : 15,
        p.id,
      ]);
      totals.discounts++;
    }

    // ── coupons ──────────────────────────────────────────────────────────
    for (const c of COUPONS) {
      const [from, to] = c.days ?? [];
      await client.query(
        `insert into coupons
           (restaurant_id, code, kind, value, max_uses, min_subtotal,
            starts_at, ends_at, created_by_email)
         values ($1,$2,$3,$4,$5,$6,
                 case when $7::int is null then null else now() + ($7 || ' days')::interval end,
                 case when $8::int is null then null else now() + ($8 || ' days')::interval end,
                 'sample@tabletap.dev')`,
        [r.id, c.code, c.kind, c.value, c.max_uses, c.min_subtotal, from ?? null, to ?? null],
      );
      totals.coupons++;
    }

    console.log(
      `  · ${r.name}: combo @ ${r.currency} ${comboPrice} (was ${regular.toFixed(2)}), ` +
        `2x1 ${priciest.name}, ${cheap.name} multi-buy, ${onSale.length} on sale, ${COUPONS.length} coupons`,
    );
  }

  console.log(
    `✓ [${label}] ${restaurants.length} restaurants — ` +
      `${totals.combos} combos, ${totals.bogo} 2x1, ${totals.tiered} tiered, ` +
      `${totals.discounts} item discounts, ${totals.coupons} coupons`,
  );
  await client.end();
}

main().catch(err => {
  console.error(`✗ [${label}] failed:`, err.message);
  process.exit(1);
});
