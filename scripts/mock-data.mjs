// ============================================================================
// TableTap — presentation/demo data ("Demo Bistro")
//
// seedMock() builds ONE self-contained demo restaurant that looks like it has
// been open for two months: a rich menu, a named team, ~60 days of orders for
// Analytics and History, live orders on the board, open bills, sittings that
// opened and closed, cancelled debts with their reasons, promotions and
// coupons that were actually redeemed, dish ratings, requests waiting on a
// manager, and the activity log all of it would have produced.
//
// Everything lives under the "Demo Bistro" restaurant and the demo-* logins,
// so dropMock() removes exactly this and nothing else — the base seed
// (test1..5, Sakura) is safe.
//
// When the app grows a new table, add it here. `pnpm test demo-coverage`
// fails when a restaurant-scoped table has no demo data, which is the reminder.
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
  { email: "demo-waiter@tabletap.dev", role: "waiter", name: "Walter Waiter" },
  { email: "demo-cashier@tabletap.dev", role: "cashier", name: "Carmen Cashier" },
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

/**
 * The connected Stripe account, kept aside across a reseed.
 *
 * Onboarding is slow, done by a person on Stripe's own site, and the account
 * that comes out of it belongs to the restaurant forever. The row here does
 * not: reseeding deletes it and writes a fresh one, which silently threw the
 * link away and left the app with no way back — the only button is "connect",
 * which creates ANOTHER account. That is how four of them accumulated with one
 * fully onboarded and none of them referenced.
 */
let keptStripe = null;

/** Removes Demo Bistro (cascades all its data) and the demo logins. */
export async function dropMock(pg) {
  const { rows } = await pg.query(
    "select id, stripe_account_id, stripe_charges_enabled from restaurants where name = $1",
    [DEMO_RESTAURANT],
  );
  for (const r of rows) {
    if (r.stripe_account_id) {
      keptStripe = {
        stripe_account_id: r.stripe_account_id,
        stripe_charges_enabled: r.stripe_charges_enabled,
      };
    }
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
    `insert into restaurants (name, tagline, logo, currency, service_pct, service_enabled, accepting_orders, owner_id, plan)
     values ($1, 'Fresh plates, fast service', '🍽️', 'MXN', 10, true, true, $2, 'casa') returning id`,
    [DEMO_RESTAURANT, ownerId],
  );
  const rid = rest.id;

  // Hand the connected account back to the restaurant that owns it.
  if (keptStripe) {
    await pg.query(
      "update restaurants set stripe_account_id = $2, stripe_charges_enabled = $3 where id = $1",
      [rid, keptStripe.stripe_account_id, keptStripe.stripe_charges_enabled],
    );
    console.log(`  Stripe link kept: ${keptStripe.stripe_account_id}`);
  }

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
    // How it was paid, what was discounted and what we took: without this
    // Analytics and the history look flat and the fee report comes out at zero.
    "pay_method",
    "discount",
    "coupon_code",
    "platform_fee",
    "receipt_sent_at",
  ];
  const orderRows = [];
  const HISTORY_DAYS = 60;
  const HISTORY_COUNT = 520;
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
    const when = randomOrderDate(HISTORY_DAYS);
    // Two in three pay by card; of those, one in five asks for the receipt by
    // email.
    const byCard = Math.random() < 0.66;
    const coupon = !cancelled && Math.random() < 0.12;
    const discount = coupon ? round2(subtotal * 0.1) : 0;
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
      when.toISOString(),
      cancelled ? null : byCard ? "card" : "cash",
      discount,
      coupon ? "BIE-N10" : null,
      // Our fee only exists when they paid by card.
      cancelled || !byCard ? 0 : 0.75,
      !cancelled && byCard && Math.random() < 0.2
        ? new Date(when.getTime() + randInt(1, 9) * 60000).toISOString()
        : null,
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
      "card",
      0,
      null,
      0.75,
      null,
    ]);
  }
  await bulkInsert(pg, "orders", orderCols, orderRows);


  // ── Sittings: the table as the floor lives it ──────────────────────────
  // Every historical order belongs to a sitting that has closed; a couple are
  // still open today, which is what fills "Open bills" and the busy tables.
  const { rows: seeded } = await pg.query(
    "select id, table_id, created_at, paid from orders where restaurant_id = $1 and table_id is not null order by created_at",
    [rid],
  );
  // One sitting per table per day: it is how they group in reality.
  const byDay = new Map();
  for (const o of seeded) {
    const key = `${o.table_id}:${new Date(o.created_at).toISOString().slice(0, 10)}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(o);
  }
  for (const [key, group] of byDay) {
    const [tableId] = key.split(":");
    const opened = new Date(group[0].created_at);
    const closed = new Date(new Date(group[group.length - 1].created_at).getTime() + 45 * 60000);
    const {
      rows: [session],
    } = await pg.query(
      `insert into table_sessions (restaurant_id, table_id, opened_at, closed_at, close_reason)
       values ($1, $2, $3, $4, 'paid') returning id`,
      [rid, tableId, opened.toISOString(), closed.toISOString()],
    );
    await pg.query("update orders set session_id = $2 where id = any($1)", [
      group.map(o => o.id),
      session.id,
    ]);
  }

  // ── Open bills: three tables seated right now ──────────────────────────
  const openTables = sample(tables, 3);
  const openBills = [];
  for (const t of openTables) {
    const {
      rows: [session],
    } = await pg.query(
      "insert into table_sessions (restaurant_id, table_id) values ($1, $2) returning id",
      [rid, t.id],
    );
    for (let k = 0; k < randInt(1, 3); k++) {
      const lines = buildLines(products);
      const subtotal = round2(
        lines.reduce((sum, l) => sum + (l.price + l.extras.reduce((x, e) => x + e.price, 0)) * l.qty, 0),
      );
      const serviceFee = round2(subtotal * 0.1);
      const {
        rows: [o],
      } = await pg.query(
        `insert into orders (restaurant_id, table_id, table_label, session_id, status, subtotal,
           service_fee, tip, total, currency, items, paid, created_at)
         values ($1,$2,$3,$4,'ready',$5,$6,0,$7,'MXN',$8,false,$9) returning id`,
        [
          rid, t.id, t.label, session.id, subtotal, serviceFee,
          round2(subtotal + serviceFee), JSON.stringify(lines),
          new Date(Date.now() - randInt(15, 120) * 60000).toISOString(),
        ],
      );
      openBills.push({ orderId: o.id, table: t, sessionId: session.id });
    }
  }

  // ── The ledger for everything already settled ─────────────────────────
  // The demo has to look like a restaurant that has been trading, and money
  // received is part of that: the till card and the daily count both read from
  // what was actually taken, not from which orders are ticked.
  await pg.query(
    `insert into payments (restaurant_id, order_id, session_id, amount, method, created_at)
     select o.restaurant_id, o.id, o.session_id, o.total,
            case when coalesce(o.pay_method, '') = 'cash' then 'cash' else 'card' end,
            o.created_at
       from orders o
      where o.restaurant_id = $1
        and o.paid
        and o.total > 0
        and not exists (select 1 from payments p where p.order_id = o.id)`,
    [rid],
  );

  // ── A written-off bill: the customer left without paying ───────────────
  const walkoutTable = tables.find(t => !openTables.includes(t)) ?? tables[0];
  const walkoutLines = buildLines(products);
  const walkoutSub = round2(
    walkoutLines.reduce((sum, l) => sum + (l.price + l.extras.reduce((x, e) => x + e.price, 0)) * l.qty, 0),
  );
  const {
    rows: [walkoutSession],
  } = await pg.query(
    `insert into table_sessions (restaurant_id, table_id, opened_at, closed_at, close_reason)
     values ($1, $2, now() - interval '3 days', now() - interval '3 days' + interval '2 hours', 'written_off')
     returning id`,
    [rid, walkoutTable.id],
  );
  await pg.query(
    `insert into orders (restaurant_id, table_id, table_label, session_id, status, subtotal,
       service_fee, tip, total, currency, items, paid, written_off, write_off_reason,
       write_off_note, written_off_by, written_off_at, created_at)
     values ($1,$2,$3,$4,'completed',$5,0,0,$5,'MXN',$6,false,true,'walkout',
       'La mesa salió mientras el mesero estaba en la cocina.',$7, now() - interval '3 days',
       now() - interval '3 days')`,
    [rid, walkoutTable.id, walkoutTable.label, walkoutSession.id, walkoutSub,
     JSON.stringify(walkoutLines), DEMO_TEAM[0].email],
  );

  // ── Promotions: a combo, a 2-for-1 and quantity pricing ────────────────
  // Icon groups: a restaurant that has already built its own, so the demo
  // shows the feature rather than an empty palette.
  for (const [variant, name, order, icons] of [
    ["addon", "Salsas de la casa", 0, [["🌶️", "Picante"], ["🥫", "BBQ"], ["🧄", "Ajo"]]],
    ["addon", "Lácteos", 1, [["🥛", "Leche"], ["🧈", "Mantequilla"], ["🍦", "Crema"]]],
    ["product", "Antojitos", 0, [["🌮", "Taco"], ["🫓", "Quesadilla"], ["🌯", "Burrito"]]],
  ]) {
    const {
      rows: [group],
    } = await pg.query(
      `insert into icon_groups (restaurant_id, variant, name, sort_order)
       values ($1,$2,$3,$4) returning id`,
      [rid, variant, name, order],
    );
    await bulkInsert(pg, "icon_group_items", ["group_id", "emoji", "label", "sort_order"],
      icons.map(([emoji, label], i) => [group.id, emoji, label, i]));
  }

  // The eight built-ins are seeded by the database when the restaurant is
  // created. These two are theirs: they show the list can be extended.
  await bulkInsert(
    pg,
    "dietary_tags",
    ["restaurant_id", "key", "label", "label_en", "emoji", "sort_order"],
    [
      [rid, "sin_azucar", "Sin azúcar", "Sugar-free", "🍬", 8],
      [rid, "de_la_casa", "Receta de la casa", "House recipe", "👩‍🍳", 9],
    ],
  );

  const forPromo = sample(products, 5);
  const {
    rows: [combo],
  } = await pg.query(
    `insert into promotions (restaurant_id, kind, name, emoji, description, combo_price, sort_order)
     values ($1,'combo','Comida del día','🍱','Plato fuerte, guarnición y bebida',$2,0) returning id`,
    [rid, round2(forPromo.slice(0, 3).reduce((sum, p) => sum + Number(p.price), 0) * 0.8)],
  );
  await bulkInsert(pg, "promotion_items", ["promotion_id", "item_id", "qty"],
    forPromo.slice(0, 3).map(p => [combo.id, p.id, 1]));

  const {
    rows: [bogo],
  } = await pg.query(
    `insert into promotions (restaurant_id, kind, name, emoji, description, buy_qty, pay_qty, sort_order)
     values ($1,'bogo','2x1 en bebidas','🍹','Martes y miércoles',2,1,1) returning id`,
    [rid],
  );
  await bulkInsert(pg, "promotion_items", ["promotion_id", "item_id", "qty"],
    [[bogo.id, forPromo[3].id, 1]]);

  const {
    rows: [tiered],
  } = await pg.query(
    `insert into promotions (restaurant_id, kind, name, emoji, description, tiers, sort_order)
     values ($1,'tiered','Más postres, mejor precio','🍰','Para compartir',$2,2) returning id`,
    [rid, JSON.stringify([{ qty: 2, price: 95 }, { qty: 3, price: 130 }])],
  );
  await bulkInsert(pg, "promotion_items", ["promotion_id", "item_id", "qty"],
    [[tiered.id, forPromo[4].id, 1]]);

  // ── Coupons, with real redemptions behind them ─────────────────────────
  const { rows: coupons } = await pg.query(
    `insert into coupons (restaurant_id, code, kind, value, max_uses, uses_count, min_subtotal, created_by_email)
     values ($1,'BIE-N10','percent',10,null,0,150,$2),
            ($1,'HOL-A50','fixed',50,100,0,200,$2),
            ($1,'VIP-U15','percent',15,20,0,0,$2)
     returning id, code`,
    [rid, DEMO_OWNER.email],
  );
  const bienvenida = coupons.find(c => c.code === "BIE-N10");
  const { rows: redeemed } = await pg.query(
    "select id, total, discount, created_at from orders where restaurant_id = $1 and coupon_code = 'BIE-N10'",
    [rid],
  );
  if (redeemed.length > 0) {
    await bulkInsert(pg, "coupon_redemptions",
      ["restaurant_id", "coupon_id", "order_id", "code", "amount", "created_at"],
      redeemed.map(o => [rid, bienvenida.id, o.id, "BIE-N10", o.discount, o.created_at]));
    await pg.query("update coupons set uses_count = $2 where id = $1", [bienvenida.id, redeemed.length]);
  }

  // ── Dish ratings ──────────────────────────────────────────────────────
  const { rows: rateable } = await pg.query(
    `select o.id as order_id, o.items from orders o
      where o.restaurant_id = $1 and o.paid and o.status = 'completed'
      order by o.created_at desc limit 90`,
    [rid],
  );
  const { rows: menuIds } = await pg.query(
    "select id, name from menu_items where restaurant_id = $1 and not is_addon", [rid]);
  const byName = new Map(menuIds.map(m => [m.name, m.id]));
  const ratings = [];
  for (const o of rateable) {
    for (const line of (o.items ?? []).slice(0, 2)) {
      const itemId = byName.get(line.name);
      if (!itemId) continue;
      // Good overall, with the odd low one: a perfect 5.0 is not believable.
      const stars = Math.random() < 0.75 ? randInt(4, 5) : randInt(2, 3);
      ratings.push([rid, itemId, o.order_id, stars]);
    }
  }
  // The constraint is (order_id, item_id): drop repeats from the same order.
  const seen = new Set();
  const uniqueRatings = ratings.filter(r => {
    const k = `${r[2]}:${r[1]}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  await bulkInsert(pg, "dish_ratings", ["restaurant_id", "item_id", "order_id", "rating"], uniqueRatings);

  // ── Things waiting on a manager's decision ────────────────────────────
  // This is what lights the bar's badges: the owner walks in and sees work.
  // ── A table part-way through agreeing to divide its bill ──────────────
  // Proposed rather than frozen: the demo should show the asking, which is the
  // part a restaurant has never seen before. Nobody's money has moved.
  const splitting = openBills[0];
  if (splitting) {
    const {
      rows: [sp],
    } = await pg.query(
      `insert into bill_splits (restaurant_id, session_id, shares, proposed_by)
       values ($1, $2, 3, 'demo-phone-1') returning id`,
      [rid, splitting.sessionId],
    );
    await pg.query(
      `insert into bill_split_claims (split_id, share_no, diner) values ($1, 0, 'demo-phone-1')`,
      [sp.id],
    );
  }

  const waiting = openBills[0];
  await pg.query(
    `insert into discount_requests (restaurant_id, table_id, table_label, order_ids, code, amount, requested_by)
     values ($1,$2,$3,$4,'VIP-15',48.50,$5)`,
    [rid, waiting.table.id, waiting.table.label, [waiting.orderId], DEMO_TEAM[1].email],
  );
  const asking = openBills[openBills.length - 1];
  await pg.query(
    `insert into write_off_requests (restaurant_id, table_id, table_label, order_ids, amount, reason, note, requested_by)
     values ($1,$2,$3,$4,$5,'comp','Se les cayó el plato, va por la casa.',$6)`,
    [rid, asking.table.id, asking.table.label, [asking.orderId], 120, DEMO_TEAM[1].email],
  );

  // ── The trail all of this would have left ─────────────────────────────
  await bulkInsert(pg, "user_logs",
    ["restaurant_id", "actor_email", "entity", "action", "detail", "created_at"],
    [
      [rid, DEMO_TEAM[0].email, "bill", "paid", `table=${openTables[0].label} orders=2 amount=412.00 method=cash`, new Date(Date.now() - 864e5).toISOString()],
      [rid, DEMO_TEAM[0].email, "bill", "written_off", `table=${walkoutTable.label} amount=${walkoutSub.toFixed(2)} reason=walkout`, new Date(Date.now() - 3 * 864e5).toISOString()],
      [rid, DEMO_TEAM[1].email, "bill", "requested", `table=${asking.table.label} reason=comp`, new Date(Date.now() - 36e5).toISOString()],
      [rid, DEMO_TEAM[1].email, "discount", "requested", `code=VIP-15 amount=48.50 table=${waiting.table.label}`, new Date(Date.now() - 18e5).toISOString()],
      [rid, DEMO_OWNER.email, "discount", "discounted", "code=BIE-N10 amount=32.00 table=4", new Date(Date.now() - 2 * 864e5).toISOString()],
      [rid, DEMO_OWNER.email, "settings", "updated", "service_pct=10", new Date(Date.now() - 20 * 864e5).toISOString()],
      [rid, DEMO_OWNER.email, "coupon", "created", "code=VIP-15", new Date(Date.now() - 12 * 864e5).toISOString()],
      [rid, DEMO_OWNER.email, "promotion", "created", "name=Comida_del_día", new Date(Date.now() - 25 * 864e5).toISOString()],
    ]);

  // ── Founder, and what Stripe charges them ─────────────────────────────
  await pg.query(
    "update restaurants set founding_number = coalesce(founding_number, 1), subscribed_price = 1499 where id = $1",
    [rid],
  );

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

  // ── Stock, and the bell that watches it ────────────────────────────────
  // A few dishes are counted so the demo shows what tracked stock looks like:
  // one comfortable, one about to run out, one already gone. The rest stay
  // untracked, which is how most of a real menu looks.
  const counted = sample(
    (await pg.query("select id, name from menu_items where restaurant_id = $1 and not is_addon", [rid])).rows,
    3,
  );
  if (counted.length === 3) {
    await pg.query("update menu_items set stock = 24 where id = $1", [counted[0].id]);
    await pg.query("update menu_items set stock = 3 where id = $1", [counted[1].id]);
    await pg.query(
      "update menu_items set stock = 0, available = false, stock_auto_off = true where id = $1",
      [counted[2].id],
    );
    await pg.query(
      "update restaurants set low_stock_alerts_enabled = true, low_stock_threshold = 5 where id = $1",
      [rid],
    );
    // The warnings those two counts would have raised, so the bell has
    // something in it the first time anybody opens the demo. One unread.
    await bulkInsert(
      pg,
      "notifications",
      ["restaurant_id", "kind", "data", "read_at"],
      [
        [rid, "low_stock", JSON.stringify({ itemId: counted[1].id, name: counted[1].name, stock: 3 }), null],
        [
          rid,
          "out_of_stock",
          JSON.stringify({ itemId: counted[2].id, name: counted[2].name, stock: 0 }),
          new Date().toISOString(),
        ],
      ],
    );
  }

  return {
    restaurantId: rid,
    tableId: tables[0].id,
    orders: orderRows.length,
    products: products.length,
  };
}
