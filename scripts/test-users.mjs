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
      "select 1 from restaurants where owner_id = $1",
      [userId]
    );
    if (existing.length === 0) {
      await pgClient.query("insert into restaurants (name, owner_id) values ($1, $2)", [
        user.restaurantName,
        userId,
      ]);
    }
    ready.push(user.email);
  }
  return ready;
}
