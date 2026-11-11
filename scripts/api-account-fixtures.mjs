import { randomBytes } from "node:crypto";
import { checked, disposableAccountRestaurant } from "./disposable-account-fixtures.mjs";

export async function apiAccountFixtures(admin, env, base) {
  const tenant = await disposableAccountRestaurant(admin, env, "apicheck-account", ["owner", "manager", "waiter", "cashier", "kitchen"]);
  try {
    const r = tenant.restaurant.id;
    const menu = await checked(admin.from("menus").insert({ restaurant_id: r, name: "Account gate", active: true }).select("id").single());
    const dish = await checked(admin.from("menu_items").insert({
      restaurant_id: r, menu_id: menu.id, name: "Account gate dish", price: 40, available: true,
    }).select("*").single());
    const account = await checked(admin.from("customer_accounts").insert({
      restaurant_id: r, name: "apicheck account", credit_limit: 1000, opened_by: tenant.emails.owner,
      code: Array.from(randomBytes(12), b => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[b & 31]).join(""),
    }).select("id, code, journal_started_at").single());
    if (!account.journal_started_at) throw new Error("API account fixture must start its journal");
    const table = await checked(admin.from("restaurant_tables").insert({ restaurant_id: r, label: "Account gate" }).select("id, label").single());
    const session = await checked(admin.from("table_sessions").insert({ restaurant_id: r, table_id: table.id }).select("id").single());
    const order = async extra => (await checked(admin.from("orders").insert({
      restaurant_id: r, status: "received", subtotal: 40, total: 40, currency: "MXN", paid: false,
      items: [{ itemId: dish.id, name: dish.name, price: 40, qty: 1, mods: {}, extras: [] }], ...extra,
    }).select("id").single())).id;
    return {
      ...tenant, admin, base, dish, lineTotal: 40, accountId: account.id, accountCode: account.code,
      acctOrder: await order({ table_id: table.id, table_label: table.label, session_id: session.id }),
      acctOrder2: await order({}), acctSessionId: session.id,
      // Public account routes use the account code, without table admission.
      phoneMembers: { cookieFor: async () => "" },
    };
  } catch (error) { await tenant.cleanup(); throw error; }
}
