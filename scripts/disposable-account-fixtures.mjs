import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { sessionCookieHeader } from "./session-cookie.mjs";
import { TERMS_VERSION } from "./terms-version.mjs";
import { loginSecret } from "./login-secrets.mjs";

export async function checked(query) {
  const { data, error } = await query;
  if (error) throw new Error(`Account fixture: ${error.message}`);
  return data;
}

/** Retained journal sources leave only through the restaurant cascade. */
export async function disposableAccountRestaurant(admin, env, name, roles = []) {
  const password = roles.length ? loginSecret("TEST_PASSWORD", env) : undefined;
  const users = [], who = { diner: "" }, emails = {};
  let restaurant;
  const cleanup = async () => {
    if (restaurant) await checked(admin.from("restaurants").delete().eq("id", restaurant.id));
    for (const id of users) await checked(admin.auth.admin.deleteUser(id));
  };
  try {
    restaurant = await checked(admin.from("restaurants").insert({
      name, plan: "casa", plan_status: "active", currency: "MXN",
      account_journal_started_at: new Date().toISOString(),
      terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString(),
    }).select("*").single());
    for (const role of roles) {
      const email = `${name}-${role}-${randomUUID()}@tabletap.dev`;
      const { user } = await checked(admin.auth.admin.createUser({ email, password, email_confirm: true }));
      users.push(user.id);
      if (role === "owner") await checked(admin.from("restaurants").update({ owner_id: user.id }).eq("id", restaurant.id));
      else await checked(admin.from("staff").insert({ restaurant_id: restaurant.id, user_id: user.id, email, role }));
      const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`Account fixture login: ${error.message}`);
      const session = data.session;
      who[role] = sessionCookieHeader(session, env.NEXT_PUBLIC_SUPABASE_URL);
      emails[role] = email;
    }
    return { restaurant, who, emails, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function chargeAccountFixture(admin, restaurant, account, orders, expected, actor = "fixture") {
  const result = await checked(admin.rpc("account_charge_v2", {
    p_restaurant: restaurant, p_account: account, p_orders: orders, p_expected: expected, p_actor: actor,
  }));
  if (result?.outcome !== "charged") throw new Error(`Account fixture charge: ${result?.outcome}`);
}
