import { createClient } from "@supabase/supabase-js";

// Convenience logins for local development. Created only against the DEV database
// by `pnpm db:seed` / `pnpm db:reset` — never seeded into production.
export const TEST_PASSWORD = "test123";
export const TEST_USERS = [1, 2, 3, 4, 5].map((n) => ({
  email: `test${n}@tabletap.dev`,
  restaurantName: `Test Restaurant ${n}`,
}));

/**
 * Creates each test user (via the Supabase Admin API) plus a restaurant they own,
 * so they can sign in and land on a dashboard. Idempotent: reuses an existing
 * auth user (drop/reset wipes restaurants but not auth.users) and skips a
 * restaurant that already exists. Returns the list of emails that are ready.
 *
 * @param {import("pg").Client} pgClient connected Postgres client
 */
export async function seedTestUsers(pgClient) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    console.warn("  (skipped test users — NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY missing)");
    return [];
  }

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ready = [];
  for (const user of TEST_USERS) {
    const { rows } = await pgClient.query("select id from auth.users where email = $1", [user.email]);
    let userId = rows[0]?.id;

    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email: user.email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (error) {
        console.warn(`  ! ${user.email}: ${error.message}`);
        continue;
      }
      userId = data.user.id;
    }

    const { rows: existing } = await pgClient.query(
      "select id from restaurants where owner_id = $1",
      [userId]
    );
    let rid = existing[0]?.id;
    if (!rid) {
      const { rows } = await pgClient.query(
        "insert into restaurants (name, owner_id) values ($1, $2) returning id",
        [user.restaurantName, userId]
      );
      rid = rows[0].id;
    }

    await ensureMenus(pgClient, rid);
    ready.push(user.email);
  }
  return ready;
}

/**
 * Every restaurant needs at least one menu. Ensures a "Main Menu" exists, then
 * adds a populated "Weekend Brunch" example menu (its own category, products and
 * an extra) so multiple menus can be tested out of the box. Idempotent.
 *
 * @param {import("pg").Client} pg connected Postgres client
 * @param {string} rid restaurant id
 */
async function ensureMenus(pg, rid) {
  const { rows: menus } = await pg.query(
    "select id, name from menus where restaurant_id = $1 order by sort_order",
    [rid]
  );

  if (menus.length === 0) {
    await pg.query(
      "insert into menus (restaurant_id, name, active, sort_order) values ($1, 'Main Menu', true, 0)",
      [rid]
    );
  }

  if (menus.some((m) => m.name === "Weekend Brunch")) return;

  const { rows: m } = await pg.query(
    `insert into menus (restaurant_id, name, active, sort_order)
     values ($1, 'Weekend Brunch', true, (select coalesce(max(sort_order) + 1, 0) from menus where restaurant_id = $1))
     returning id`,
    [rid]
  );
  const mid = m[0].id;

  const { rows: c } = await pg.query(
    "insert into categories (restaurant_id, menu_id, name, sort_order) values ($1, $2, 'Brunch', 1) returning id",
    [rid, mid]
  );
  const catId = c[0].id;

  await pg.query(
    `insert into menu_items (restaurant_id, menu_id, category_id, name, description, price, emoji, popular, sort_order) values
       ($1, $2, $3, 'Pancakes', 'Stack of three with maple syrup', 9.00, '🥞', true, 1),
       ($1, $2, $3, 'Avocado Toast', 'Sourdough, smashed avo, chili flakes', 8.50, '🥑', false, 2)`,
    [rid, mid, catId]
  );

  const { rows: a } = await pg.query(
    "insert into menu_items (restaurant_id, menu_id, name, price, emoji, is_addon, sort_order) values ($1, $2, 'Maple syrup', 1.00, '🍁', true, 1) returning id",
    [rid, mid]
  );

  await pg.query(
    "insert into item_addons (product_id, addon_id) select p.id, $3 from menu_items p where p.restaurant_id = $1 and p.menu_id = $2 and p.name = 'Pancakes'",
    [rid, mid, a[0].id]
  );
}
