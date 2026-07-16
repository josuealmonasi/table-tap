import { createClient } from "@supabase/supabase-js";
import { populateMenu } from "./menu-catalog.mjs";

// Convenience logins created by `pnpm db:seed` / `pnpm db:reset` on BOTH
// environments (this is a test prod — a reset orphans the surviving auth
// logins unless seeding re-links them).
export const TEST_PASSWORD = "test123";
export const TEST_USERS = [1, 2, 3, 4, 5].map(n => ({
  email: `test${n}@tabletap.dev`,
  restaurantName: `Test Restaurant ${n}`,
}));

// Team logins, re-linked to their restaurants idempotently on every seed.
export const TEAM_LOGINS = [
  { email: "manager1@tabletap.dev", role: "manager", restaurant: "Test Restaurant 1" },
  { email: "kitchen1@tabletap.dev", role: "kitchen", restaurant: "Test Restaurant 1" },
  { email: "owner2@tabletap.dev", role: "owner", restaurant: "Test Restaurant 1" },
  { email: "manager2@tabletap.dev", role: "manager", restaurant: "Test Restaurant 2" },
  { email: "kitchen2@tabletap.dev", role: "kitchen", restaurant: "Test Restaurant 2" },
];

/**
 * Creates each test user (via the Supabase Admin API) plus a restaurant they own,
 * so they can sign in and land on a dashboard. Idempotent: reuses an existing
 * auth user (drop/reset wipes restaurants but not auth.users) and skips a
 * restaurant that already exists. Returns the list of emails that are ready.
 *
 * @param {import("pg").Client} pgClient connected Postgres client
 */
/**
 * Ensures the platform admin login exists and is linked, on every seed/reset
 * (dev AND prod — the admin is infrastructure, not demo data). Reads
 * PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD from the target env file;
 * quietly does nothing when the email isn't configured. The password is only
 * used when the auth user doesn't exist yet — it never resets an existing one.
 *
 * @param {import("pg").Client} pgClient connected Postgres client
 * @returns {Promise<string | null>} the admin email that's ready, or null
 */
export async function ensurePlatformAdmin(pgClient) {
  const email = process.env.PLATFORM_ADMIN_EMAIL;
  if (!email) return null;

  const { rows } = await pgClient.query("select id from auth.users where email = $1", [
    email,
  ]);
  let userId = rows[0]?.id;

  if (!userId) {
    const password = process.env.PLATFORM_ADMIN_PASSWORD;
    if (!password) {
      console.warn(
        `  ! ${email}: not in auth and PLATFORM_ADMIN_PASSWORD is unset — skipped`,
      );
      return null;
    }
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SECRET_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) {
      console.warn(`  ! ${email}: ${error.message}`);
      return null;
    }
    userId = data.user.id;
  }

  await pgClient.query(
    `insert into platform_admins (user_id, email) values ($1, $2)
     on conflict (user_id) do nothing`,
    [userId, email],
  );
  return email;
}

export async function seedTestUsers(pgClient) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    console.warn(
      "  (skipped test users — NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY missing)",
    );
    return [];
  }

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ready = [];
  for (const user of TEST_USERS) {
    const { rows } = await pgClient.query("select id from auth.users where email = $1", [
      user.email,
    ]);
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
      [userId],
    );
    let rid = existing[0]?.id;
    if (!rid) {
      const { rows } = await pgClient.query(
        "insert into restaurants (name, owner_id) values ($1, $2) returning id",
        [user.restaurantName, userId],
      );
      rid = rows[0].id;
    }

    await ensureMenus(pgClient, rid);
    ready.push(user.email);
  }
  return ready;
}

/**
 * Ensures the team test logins (managers/kitchen/co-owner) exist and are
 * linked to their restaurants. Idempotent like seedTestUsers: reuses existing
 * auth users and upserts the staff rows, so a reset that wiped `staff` heals
 * on the next seed. Run AFTER seedTestUsers (needs the restaurants).
 *
 * @param {import("pg").Client} pgClient connected Postgres client
 */
export async function seedTeamLogins(pgClient) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return [];

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ready = [];
  for (const member of TEAM_LOGINS) {
    const { rows: r } = await pgClient.query(
      "select id from restaurants where name = $1",
      [member.restaurant],
    );
    if (!r[0]) {
      console.warn(`  ! ${member.email}: restaurant "${member.restaurant}" not found`);
      continue;
    }

    const { rows: u } = await pgClient.query(
      "select id from auth.users where email = $1",
      [member.email],
    );
    let userId = u[0]?.id;
    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email: member.email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (error) {
        console.warn(`  ! ${member.email}: ${error.message}`);
        continue;
      }
      userId = data.user.id;
    }

    await pgClient.query(
      `insert into staff (restaurant_id, user_id, email, role) values ($1, $2, $3, $4)
       on conflict (user_id) do update set restaurant_id = $1, role = $4`,
      [r[0].id, userId, member.email, member.role],
    );
    ready.push(`${member.email} (${member.role})`);
  }
  return ready;
}

/**
 * Ensures each restaurant has two example menus ("Main Menu", "Weekend Brunch")
 * and fills each with a randomized catalog (≥20 dishes + ≥10 extras, random
 * popular/available flags and product↔extra links) via populateMenu(). Both the
 * menu-existence check and the population are idempotent, so re-running
 * `db:seed` won't create duplicates.
 *
 * @param {import("pg").Client} pg connected Postgres client
 * @param {string} rid restaurant id
 */
async function ensureMenus(pg, rid) {
  const wanted = [
    { name: "Main Menu", sort: 0 },
    { name: "Weekend Brunch", sort: 1 },
  ];

  const { rows: existing } = await pg.query(
    "select name from menus where restaurant_id = $1",
    [rid],
  );
  const names = new Set(existing.map(m => m.name));
  for (const { name, sort } of wanted) {
    if (!names.has(name)) {
      await pg.query(
        "insert into menus (restaurant_id, name, active, sort_order) values ($1, $2, true, $3)",
        [rid, name, sort],
      );
    }
  }

  // Populate every menu this restaurant has.
  const { rows: menus } = await pg.query(
    "select id from menus where restaurant_id = $1 order by sort_order",
    [rid],
  );
  for (const { id } of menus) await populateMenu(pg, rid, id);
}
