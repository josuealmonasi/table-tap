import { createClient } from "@supabase/supabase-js";
import { populateMenu } from "./menu-catalog.mjs";

// Kept in step with src/lib/legal.ts by hand — a seeded demo account that has
// never accepted the terms greets whoever opens it with a modal.
const TERMS_VERSION = "2026-08-18";

// Convenience logins created by `pnpm db:seed` / `pnpm db:reset` on BOTH
// environments (this is a test prod — a reset orphans the surviving auth
// logins unless seeding re-links them).
export const TEST_PASSWORD = "test123";
/**
 * One test restaurant per tier, so every gate can be demonstrated by signing in
 * rather than by editing the database.
 *
 * Test 1 is deliberately the free tier: it is the account that proves a table
 * QR falls back to the counter menu, that coupons and promotions are refused,
 * and that the dish ceiling bites. Test 5 sits on Grupo, which nobody can buy
 * yet — useful for seeing what it unlocks before the tier is finished.
 *
 * A tier with a low ceiling gets a smaller seeded menu: the plan triggers
 * refuse the 31st dish on Carta, and a seed that fails halfway is worse than a
 * demo restaurant with a short menu.
 */
export const TEST_USERS = [
  { email: "test1@tabletap.dev", restaurantName: "Test Restaurant 1", plan: "carta" },
  { email: "test2@tabletap.dev", restaurantName: "Test Restaurant 2", plan: "servicio" },
  { email: "test3@tabletap.dev", restaurantName: "Test Restaurant 3", plan: "casa" },
  { email: "test4@tabletap.dev", restaurantName: "Test Restaurant 4", plan: "grupo" },
  {
    email: "test5@tabletap.dev",
    restaurantName: "Test Restaurant 5",
    plan: "servicio",
    // Its trial ran out yesterday: the account for showing what a lapsed
    // subscription looks like without waiting thirty days for one.
    lapsedTrial: true,
  },
];

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
 * Four tables per test restaurant, so every account can demonstrate dine-in.
 *
 * Created before the tier is applied, which is the only order that works: the
 * ceilings are INSERT triggers, so a Carta restaurant could never be given
 * one afterwards. That is also what makes the free-tier account worth having —
 * it owns tables and still falls back to the counter menu, exactly like a
 * restaurant whose subscription lapsed.
 */
async function ensureTables(pgClient, restaurantId) {
  const { rows } = await pgClient.query(
    "select count(*)::int as n from restaurant_tables where restaurant_id = $1",
    [restaurantId],
  );
  if (rows[0].n > 0) return;
  for (const label of ["1", "2", "3", "4"]) {
    await pgClient.query(
      "insert into restaurant_tables (restaurant_id, label) values ($1, $2)",
      [restaurantId, label],
    );
  }
}

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
        // The tier is part of what each test account is for. A lapsed trial is
        // recorded as one — trialing, with an end date already in the past —
        // so the app settles it on the next request exactly as it would in
        // real life, rather than being handed a pre-cooked result.
        // Created on the top tier so the seed has room to build a full demo:
        // the limits are INSERT triggers, and Carta would refuse this
        // restaurant's tables and its 31st dish halfway through. The tier this
        // account is actually for is applied below, once everything exists —
        // which is also what a real downgrade looks like, rows and all.
        `insert into restaurants (name, owner_id, plan, terms_version,
                                  terms_accepted_at, terms_accepted_email)
         values ($1, $2, 'casa', $3, now(), $1) returning id`,
        [user.restaurantName, userId, TERMS_VERSION],
      );
      rid = rows[0].id;
    }

    await ensureMenus(pgClient, rid);
    await ensureTables(pgClient, rid);

    // Now the tier, with the demo data already in place. Applied on every seed
    // so an account that somebody clicked around in goes back to being the
    // thing it is for. A lapsed trial is recorded as a real one whose date has
    // passed, so the app settles it on the next request the way it would in
    // life rather than being handed the answer.
    await pgClient.query(
      `update restaurants
          set plan = $1, plan_status = $2, trial_ends_at = $3
        where id = $4`,
      [
        user.plan ?? "casa",
        user.lapsedTrial ? "trialing" : "active",
        user.lapsedTrial ? new Date(Date.now() - 86400000).toISOString() : null,
        rid,
      ],
    );

    ready.push(`${user.email} (${user.plan ?? "casa"}${user.lapsedTrial ? ", prueba vencida" : ""})`);
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
