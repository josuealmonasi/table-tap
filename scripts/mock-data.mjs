// ============================================================================
// TableTap — presentation/demo data ("Demo Bistro")
//
// seedMock() builds ONE self-contained demo restaurant with a rich menu,
// a named team, ~30 days of realistic orders (for Analytics + History), a few
// live orders on the board, and open service requests. Everything lives under
// the "Demo Bistro" restaurant and the demo-* logins, so dropMock() removes
// exactly this and nothing else — the base seed (test1..5, Sakura) is safe.
//
// Reused by scripts/db.mjs for `pnpm db:mock` and `pnpm db:dropmock`.
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { populateMenu } from "./menu-catalog.mjs";
import { bulkInsert, randInt, sample, shuffle } from "./menu-catalog.mjs";

export const DEMO_RESTAURANT = "Demo Bistro";
export const DEMO_PASSWORD = "demo123";
export const DEMO_OWNER = { email: "demo@tabletap.dev", name: "Diego Owner" };
export const DEMO_TEAM = [
  { email: "demo-manager@tabletap.dev", role: "manager", name: "María Manager" },
  { email: "demo-kitchen@tabletap.dev", role: "kitchen", name: "Carlos Kitchen" },
];
const DEMO_EMAILS = [DEMO_OWNER.email, ...DEMO_TEAM.map(t => t.email)];

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Reuse an existing auth user (surviving a drop) or create one. */
async function ensureUser(pg, admin, email, name) {
  const { rows } = await pg.query("select id from auth.users where email = $1", [email]);
  let userId = rows[0]?.id;
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: DEMO_PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(`${email}: ${error.message}`);
    userId = data.user.id;
  }
  if (name) {
    await pg.query(
      `insert into profiles (user_id, full_name, updated_at)
       values ($1, $2, now())
       on conflict (user_id) do update set full_name = $2`,
      [userId, name],
    );
  }
  return userId;
}

/** Removes Demo Bistro (cascades all its data) and the demo logins. */
export async function dropMock(pg) {
  const { rows } = await pg.query("select id from restaurants where name = $1", [
    DEMO_RESTAURANT,
  ]);
  for (const r of rows) {
    await pg.query("delete from restaurants where id = $1", [r.id]);
  }
  const admin = adminClient();
  for (const email of DEMO_EMAILS) {
    const { rows: u } = await pg.query("select id from auth.users where email = $1", [
      email,
    ]);
    if (u[0]) await admin.auth.admin.deleteUser(u[0].id);
  }
  return rows.length;
}

// Order timing: weight orders toward lunch (12–15) and dinner (19–22).
const HOUR_WEIGHTS = [
  0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 5, 9, 10, 8, 4, 3, 3, 6, 10, 10, 7, 3, 1,
];
function weightedHour() {
  const total = HOUR_WEIGHTS.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let h = 0; h < 24; h++) {
    r -= HOUR_WEIGHTS[h];
    if (r < 0) return h;
  }
  return 13;
}

/** A random order timestamp within the last `days`, weekend- and recency-biased. */
function randomOrderDate(days) {
  // Bias toward recent days: square of a uniform pushes mass toward 0 (today).
  let back = Math.floor(Math.pow(Math.random(), 2) * days);
  const d = new Date();
  d.setDate(d.getDate() - back);
  // Weekends are busier — occasionally pull a weekday order onto Fri/Sat.
  const dow = d.getDay();
  if (dow !== 0 && dow !== 5 && dow !== 6 && Math.random() < 0.25) {
    d.setDate(d.getDate() - ((dow + 2) % 7)); // nudge toward the weekend
  }
  d.setHours(weightedHour(), randInt(0, 59), randInt(0, 59), 0);
  if (d > new Date()) d.setHours(d.getHours() - 3); // never in the future
  return d;
}

/** Builds one order's line items from the demo menu, with extras + modifiers. */
function buildLines(products) {
  const chosen = sample(products, randInt(1, 4));
  return chosen.map(p => {
    const extras = p.extras.length && Math.random() < 0.4 ? sample(p.extras, randInt(1, 2)) : [];
    const mods = {};
    if (p.modifiers.length && Math.random() < 0.6) {
      for (const m of p.modifiers) {
        if (m.type === "single") mods[m.label] = sample(m.options, 1)[0];
        else mods[m.label] = sample(m.options, randInt(1, m.options.length));
      }
    }
    return {
      itemId: p.id,
      name: p.name,
      emoji: p.emoji,
      price: Number(p.price),
      qty: randInt(1, 3),
      mods,
      extras: extras.map(e => ({ id: e.id, name: e.name, emoji: e.emoji, price: Number(e.price) })),
    };
  });
}

const round2 = n => Math.round(n * 100) / 100;

/** Draws a tip amount for an order (mostly none, sometimes a %, rarely custom). */
function pickTip(subtotal) {
  const r = Math.random();
  if (r < 0.55) return 0;
  if (r < 0.95) return round2(subtotal * sample([0.1, 0.15, 0.2], 1)[0]);
  return sample([10, 20, 25, 30, 50], 1)[0]; // a round custom amount
}

export async function seedMock(pg) {
  if (!process.env.SUPABASE_SECRET_KEY) {
    throw new Error("SUPABASE_SECRET_KEY missing — needed to create demo logins.");
  }
  await dropMock(pg); // clean slate → repeatable

  const admin = adminClient();
  const ownerId = await ensureUser(pg, admin, DEMO_OWNER.email, DEMO_OWNER.name);

  // ── Restaurant + tables ──
  const {
    rows: [rest],
  } = await pg.query(
    `insert into restaurants (name, tagline, logo, currency, service_pct, service_enabled, accepting_orders, owner_id)
     values ($1, 'Fresh plates, fast service', '🍽️', 'MXN', 10, true, true, $2) returning id`,
    [DEMO_RESTAURANT, ownerId],
  );
  const rid = rest.id;
  const tables = await bulkInsert(
    pg,
    "restaurant_tables",
    ["restaurant_id", "label"],
    Array.from({ length: 10 }, (_, i) => [rid, String(i + 1)]),
    "id, label",
  );

  // ── Menus (rich catalog via the shared populator) ──
  for (const [name, sort] of [
    ["Main Menu", 0],
    ["Weekend Brunch", 1],
  ]) {
    const {
      rows: [m],
    } = await pg.query(
      "insert into menus (restaurant_id, name, active, sort_order) values ($1, $2, true, $3) returning id",
      [rid, name, sort],
    );
    await populateMenu(pg, rid, m.id);
  }

  // Showcase option groups (modifiers) on a handful of products.
  const { rows: allProducts } = await pg.query(
    "select id, name from menu_items where restaurant_id = $1 and not is_addon",
    [rid],
  );
  const spice = { label: "Spice level", type: "single", options: ["Mild", "Medium", "Hot"] };
  const size = { label: "Size", type: "single", options: ["Regular", "Large (+$2)"] };
  const milk = { label: "Milk", type: "multi", options: ["Oat", "Soy", "Almond"] };
  for (const p of sample(allProducts, Math.min(6, allProducts.length))) {
    const mods = /coffee|latte|tea|drink/i.test(p.name)
      ? [size, milk]
      : [spice];
    await pg.query("update menu_items set modifiers = $2 where id = $1", [
      p.id,
      JSON.stringify(mods),
    ]);
  }

  // Dietary / allergen tags on products whose names imply them, so the demo
  // shows the badges and the customer filter.
  const dietaryFor = name => {
    const tags = [];
    if (/salad|edamame|veg|tofu|buddha|rice/i.test(name)) tags.push("vegetarian");
    if (/salad|edamame|buddha|veg|lemonade|tea|water/i.test(name)) tags.push("vegan");
    if (/salad|rice|edamame|steak|salmon|fries/i.test(name)) tags.push("gluten_free");
    if (/wing|curry|taco|nacho|ramen/i.test(name)) tags.push("spicy");
    if (/salmon|calamari|prawn|fish|sushi|shrimp/i.test(name)) tags.push("seafood");
    return [...new Set(tags)];
  };
  for (const p of allProducts) {
    const tags = dietaryFor(p.name);
    if (tags.length) {
      await pg.query("update menu_items set dietary = $2 where id = $1", [p.id, tags]);
    }
  }

  // ── Team (manager + kitchen) with names, plus an activity log ──
  const logs = [];
  for (const member of DEMO_TEAM) {
    const uid = await ensureUser(pg, admin, member.email, member.name);
    await pg.query(
      `insert into staff (restaurant_id, user_id, email, role) values ($1, $2, $3, $4)
       on conflict (user_id) do update set restaurant_id = $1, role = $4`,
      [rid, uid, member.email, member.role],
    );
    logs.push([rid, DEMO_OWNER.email, "created", member.role, member.email]);
  }
  logs.push([rid, DEMO_OWNER.email, "updated", "manager", DEMO_TEAM[0].email]);
  await bulkInsert(
    pg,
    "user_logs",
    ["restaurant_id", "actor_email", "action", "target_role", "target_email"],
    logs,
  );

  // ── Orders: menu with extras + modifiers for realistic line items ──
  const { rows: products } = await pg.query(
    `select p.id, p.name, p.emoji, p.price, p.modifiers,
       coalesce(
         json_agg(json_build_object('id', a.id, 'name', a.name, 'emoji', a.emoji, 'price', a.price))
           filter (where a.id is not null), '[]'
       ) as extras
     from menu_items p
     left join item_addons ia on ia.product_id = p.id
     left join menu_items a on a.id = ia.addon_id
     where p.restaurant_id = $1 and not p.is_addon and p.available
     group by p.id`,
    [rid],
  );

  const orderCols = [
    "restaurant_id",
    "table_id",
    "table_label",
    "status",
    "subtotal",
    "service_fee",
    "tip",
    "total",
    "currency",
    "items",
    "paid",
    "stripe_refund_id",
    "created_at",
  ];
  const orderRows = [];
  const HISTORY_COUNT = 240;
  for (let i = 0; i < HISTORY_COUNT; i++) {
    const lines = buildLines(products);
    const subtotal = round2(
      lines.reduce(
        (s, l) => s + (l.price + l.extras.reduce((x, e) => x + e.price, 0)) * l.qty,
        0,
      ),
    );
    const serviceFee = round2(subtotal * 0.1);
    const tip = pickTip(subtotal);
    const cancelled = Math.random() < 0.07;
    const t = tables[randInt(0, tables.length - 1)];
    orderRows.push([
      rid,
      t.id,
      t.label,
      cancelled ? "cancelled" : "completed",
      subtotal,
      serviceFee,
      tip,
      round2(subtotal + serviceFee + tip),
      "MXN",
      JSON.stringify(lines),
      true,
      cancelled ? `re_demo_${i}` : null,
      randomOrderDate(30).toISOString(),
    ]);
  }

  // A few LIVE orders today so the board isn't empty (one per active status).
  const now = new Date();
  for (const status of ["received", "received", "preparing", "ready"]) {
    const lines = buildLines(products);
    const subtotal = round2(
      lines.reduce(
        (s, l) => s + (l.price + l.extras.reduce((x, e) => x + e.price, 0)) * l.qty,
        0,
      ),
    );
    const serviceFee = round2(subtotal * 0.1);
    const tip = pickTip(subtotal);
    const t = tables[randInt(0, tables.length - 1)];
    const when = new Date(now.getTime() - randInt(2, 90) * 60000);
    orderRows.push([
      rid,
      t.id,
      t.label,
      status,
      subtotal,
      serviceFee,
      tip,
      round2(subtotal + serviceFee + tip),
      "MXN",
      JSON.stringify(lines),
      true,
      null,
      when.toISOString(),
    ]);
  }
  await bulkInsert(pg, "orders", orderCols, orderRows);

  // ── Open service requests (call waiter / bill) on a few tables ──
  const reqTables = sample(tables, 3);
  await bulkInsert(
    pg,
    "service_requests",
    ["restaurant_id", "table_id", "table_label", "kind"],
    [
      [rid, reqTables[0].id, reqTables[0].label, "waiter"],
      [rid, reqTables[1].id, reqTables[1].label, "bill"],
      [rid, reqTables[2].id, reqTables[2].label, "waiter"],
    ],
  );

  return {
    restaurantId: rid,
    tableId: tables[0].id,
    orders: orderRows.length,
    products: products.length,
  };
}
