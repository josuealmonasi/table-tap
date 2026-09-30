// ============================================================================
// The demo's customer accounts.
//
// One customer who owes across two days — so the statement has days to show,
// the till has an account to charge and the gates have a balance to collect —
// and one whose account is open and owes nothing. Their orders are delivered
// and not paid: `paid` false and `account_id` set, which every reader of what
// a table owes leaves out.
// ============================================================================
import { randomBytes } from "node:crypto";
import { bulkInsert } from "./menu-catalog.mjs";

// The visit card's alphabet; customer_accounts.code refuses anything else.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const code = () => Array.from(randomBytes(12), b => ALPHABET[b & 31]).join("");
const round2 = n => Math.round(n * 100) / 100;

export const DEMO_ACCOUNT = "Carmen Ruiz";

export async function seedAccounts(pg, rid) {
  const { rows: dishes } = await pg.query(
    `select id, name, price, emoji from menu_items
      where restaurant_id = $1 and is_addon = false and available = true
      order by name limit 3`,
    [rid],
  );
  if (dishes.length < 2) return;

  const [carmen] = await bulkInsert(
    pg,
    "customer_accounts",
    ["restaurant_id", "name", "code", "credit_limit", "opened_by"],
    [[rid, DEMO_ACCOUNT, code(), 2000, "demo@tabletap.dev"]],
    "id",
  );
  await bulkInsert(
    pg,
    "customer_accounts",
    ["restaurant_id", "name", "code", "credit_limit", "opened_by"],
    [[rid, "Luis Ortega", code(), 1000, "demo-manager@tabletap.dev"]],
  );

  const now = Date.now();
  const charges = [
    { dishes: dishes.slice(0, 2), at: new Date(now - 26 * 3600_000) },
    { dishes: dishes.slice(1, 3), at: new Date(now - 2 * 3600_000) },
  ];
  const rows = charges.map(c => {
    const items = c.dishes.map(d => ({
      itemId: d.id, name: d.name, emoji: d.emoji, price: Number(d.price), qty: 1, mods: {}, extras: [],
    }));
    const subtotal = round2(items.reduce((s, l) => s + l.price, 0));
    return [
      rid, "completed", subtotal, 0, 0, subtotal, "MXN", JSON.stringify(items),
      false, null, c.at.toISOString(), carmen.id, "demo-cashier@tabletap.dev", c.at.toISOString(),
    ];
  });
  await bulkInsert(
    pg,
    "orders",
    ["restaurant_id", "status", "subtotal", "service_fee", "tip", "total", "currency", "items",
     "paid", "pay_method", "created_at", "account_id", "charged_by", "charged_at"],
    rows,
  );
}
