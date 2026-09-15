// ============================================================================
// TableTap — RLS and API access check
//
// Asks the database and the running app the only questions that matter:
//   · can the key that ships to every diner's phone read what it must not?
//   · can a signed-in restaurant reach another restaurant's data?
//   · can anyone but the server call the privileged functions?
//   · do the API routes refuse a caller with no session, and a caller from
//     the wrong restaurant?
//
//   pnpm rls            (dev, and the app on localhost:3000)
//   pnpm rls --prod
// ============================================================================
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { plantNeighbour } from "./rls-fixture.mjs";

const prod = process.argv.includes("--prod");
process.loadEnvFile(join(process.cwd(), prod ? ".env.production.local" : ".env.development.local"));
const BASE = prod
  ? (process.env.PROD_SITE_URL ?? "https://table-tap-star.vercel.app")
  : "http://localhost:3000";

const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
);

let failed = 0;
const ok = m => console.log(`  ok       ${m}`);
const bad = m => { failed++; console.log(`  LEAK     ${m}`); };

function verdict(label, { data, error }) {
  // A refusal is either an error or an empty result — both mean "you saw nothing".
  if (error || !data || data.length === 0) ok(label);
  else bad(`${label} — returned ${data.length} row(s)`);
}

console.log(`\nRLS check — ${prod ? "production" : "development"}\n`);

// ── 1. The publishable key, which ships to every phone ─────────────────────
console.log("The key on every diner's phone");
for (const table of [
  "orders", "table_sessions", "write_off_requests", "discount_requests",
  "coupons", "coupon_redemptions", "staff", "user_logs", "profiles",
  "platform_admins", "rate_limits", "restaurant_tables",
  "icon_groups", "icon_group_items",
]) {
  verdict(`cannot read ${table}`, await anon.from(table).select("*").limit(1));
}
// Columns it may read on restaurants — but not the ones about money or founders.
const { data: rcols, error: rerr } = await anon
  .from("restaurants")
  .select("id, name, currency")
  .limit(1);
if (rerr || !rcols?.length) bad("cannot read the public restaurant columns it needs");
else ok("reads only the public restaurant columns");
for (const col of ["founding_number", "subscribed_price", "stripe_account_id", "owner_id"]) {
  const { error } = await anon.from("restaurants").select(col).limit(1);
  if (error) ok(`cannot read restaurants.${col}`);
  else bad(`can read restaurants.${col}`);
}

// Dietary tags ARE public: they show on the dish and filter the menu. What is
// tested here is that they can be read — if the grant ever fell away, the menu
// would lose its allergens with nothing complaining.
{
  const { data, error } = await anon.from("dietary_tags").select("key, label, emoji").limit(1);
  if (!error && data?.length) ok("reads the dietary tags the menu shows");
  else bad(`cannot read dietary_tags (${error?.message ?? "no rows"})`);
}

// ── 2. Privileged functions ────────────────────────────────────────────────
console.log("\nFunctions only the server may call");
for (const [fn, args] of [
  ["open_table_session", { p_restaurant: crypto.randomUUID(), p_table: crypto.randomUUID(), p_max_hours: 8 }],
  ["close_session_if_clear", { p_session: crypto.randomUUID(), p_reason: "paid" }],
  ["claim_founding_price", { p_restaurant: crypto.randomUUID(), p_limit: 50 }],
  ["redeem_coupon", { p_coupon_id: crypto.randomUUID() }],
  ["rate_limit_hit", { p_bucket: "probe", p_window_seconds: 60 }],
  // Seeding dietary tags belongs to the trigger and nobody else. RLS would stop
  // it anyway; the grant stops it before it reaches the table.
  ["seed_dietary_tags", { p_restaurant: crypto.randomUUID() }],
]) {
  const { error } = await anon.rpc(fn, args);
  if (error) ok(`anon cannot call ${fn}()`);
  else bad(`anon called ${fn}()`);
}

// ── 3. One restaurant reaching another ─────────────────────────────────────
console.log("\nA signed-in restaurant reaching another's data");
// The pair is CHOSEN, not whatever the database hands back first.
//
// It used to take `restaurants[0]` from an unordered `limit(3)` and sign in
// with one hardcoded password. The row that came back first was a seeded
// restaurant with a null `owner_id`, so there was no owner to be, and the
// whole section below — eight cross-tenant reads and a write — printed
// SKIPPED and ran none of it. Every run, on every machine, for as long as
// that row happened to sort first.
const { data: restaurants } = await admin.from("restaurants").select("id, name, owner_id");
const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });

const asUser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

// Whoever can actually be signed in as. Both passwords, because the demo
// restaurant and the test ones do not share one.
let mine = null;
let signIn = { error: new Error("no restaurant has an owner who can sign in") };
for (const r of restaurants ?? []) {
  const owner = users?.users?.find(u => u.id === r.owner_id);
  if (!owner?.email) continue;
  for (const password of ["demo123", "test123"]) {
    const attempt = await asUser.auth.signInWithPassword({ email: owner.email, password });
    if (!attempt.error) { mine = r; signIn = attempt; break; }
  }
  if (mine) break;
}
const theirs = restaurants?.find(r => r.id !== mine?.id);

// The victim needs something worth stealing.
//
// Every read below was passing because the restaurant next door happened to
// be empty — eight tables, eight green ticks, nothing asked. Planted here,
// attacked by this section AND by the every-table sweep further down, and
// removed at the end whatever happens in between.
const fixture = !prod && theirs ? await plantNeighbour(admin, theirs.id) : null;
if (!prod && theirs && !fixture?.planted.order) {
  bad("could not plant anything in the restaurant next door — the reads below prove nothing");
}

if (signIn.error || !mine || !theirs) {
  // Loud, never skipped: a security section that does not run has to look
  // like a failure, or it reads as a pass forever.
  bad(`the cross-tenant checks did not run — ${signIn.error?.message ?? "no second restaurant"}`);
} else {
  for (const table of ["orders", "table_sessions", "write_off_requests", "discount_requests", "coupons", "user_logs", "staff", "icon_groups"]) {
    verdict(
      `${mine.name} cannot read ${theirs.name}'s ${table}`,
      await asUser.from(table).select("id").eq("restaurant_id", theirs.id).limit(1),
    );
  }
  // And must not be able to write into their tables either.
  const { error: wErr } = await asUser
    .from("restaurant_tables")
    .insert({ restaurant_id: theirs.id, label: "intruso" })
    .select();
  if (wErr) ok(`${mine.name} cannot add a table to ${theirs.name}`);
  else bad(`${mine.name} added a table to ${theirs.name}`);
}

// ── 4. The API routes, with no session at all ──────────────────────────────
console.log("\nAPI routes without a session");
for (const [method, path, body] of [
  ["GET", "/api/table-bill?tableId=" + crypto.randomUUID(), null],
  ["GET", "/api/badges", null],
  ["POST", "/api/bill/write-off", { tableId: crypto.randomUUID(), reason: "walkout" }],
  ["POST", "/api/bill/write-off/approve", { requestId: crypto.randomUUID(), approve: true }],
  ["POST", "/api/table-payment", { tableId: crypto.randomUUID(), settlement: "cash" }],
  ["POST", "/api/settings", { name: "hacked" }],
  ["POST", "/api/coupons", { code: "AAA-BBB", kind: "percent", value: 10 }],
  ["POST", "/api/staff", { email: "x@y.z", role: "owner" }],
  ["PATCH", "/api/orders", { id: crypto.randomUUID(), status: "ready" }],
  ["POST", "/api/dietary-tags", { label: "colado" }],
  ["PATCH", "/api/dietary-tags", { id: crypto.randomUUID(), label: "colado" }],
  ["DELETE", "/api/dietary-tags", { id: crypto.randomUUID() }],
  ["POST", "/api/icon-groups", { name: "colado", variant: "addon", icons: [{ emoji: "🌮" }] }],
  ["PATCH", "/api/icon-groups", { id: crypto.randomUUID(), name: "colado" }],
  ["DELETE", "/api/icon-groups", { id: crypto.randomUUID() }],
]) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 || res.status === 403) ok(`${method} ${path.split("?")[0]} → ${res.status}`);
  else bad(`${method} ${path.split("?")[0]} → ${res.status} (expected 401/403)`);
}

// ── 5. Signed in, but pointing at the restaurant next door ────────────────
// The realistic case: not a stranger, but one of our own customers with a
// valid session sending another restaurant's id.
if (!signIn.error && theirs) {
  console.log("\nSigned in, aiming at another restaurant");
  const cookie = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token=base64-${Buffer.from(JSON.stringify(signIn.data.session)).toString("base64")}`;
  const { data: theirTables } = await admin
    .from("restaurant_tables").select("id").eq("restaurant_id", theirs.id).limit(1);
  const theirTable = theirTables?.[0]?.id;
  const { data: theirOrders } = await admin
    .from("orders").select("id").eq("restaurant_id", theirs.id).eq("paid", false).limit(1);

  const call = async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method, headers: { "Content-Type": "application/json", cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, text: await res.text() };
  };

  if (theirTable) {
    const r1 = await call("GET", `/api/table-bill?tableId=${theirTable}`);
    // The endpoint scopes by the actor's restaurant, so it must come back empty.
    if (r1.status !== 200 || /"orders":\s*\[\]/.test(r1.text)) ok("table-bill of another restaurant's table is empty");
    else bad(`table-bill returned another restaurant's bill: ${r1.text.slice(0, 90)}`);

    const r2 = await call("POST", "/api/table-payment", { tableId: theirTable, settlement: "cash" });
    if (r2.status >= 400) ok(`cannot settle another restaurant's table (${r2.status})`);
    else bad(`settled another restaurant's table (${r2.status})`);

    const r3 = await call("POST", "/api/bill/write-off", { tableId: theirTable, reason: "walkout" });
    if (r3.status >= 400) ok(`cannot cancel another restaurant's bill (${r3.status})`);
    else bad(`cancelled another restaurant's bill (${r3.status})`);
  }
  if (theirOrders?.[0]) {
    const r4 = await call("PATCH", "/api/orders", { id: theirOrders[0].id, status: "ready" });
    if (r4.status >= 400) ok(`cannot move another restaurant's order (${r4.status})`);
    else bad(`moved another restaurant's order (${r4.status})`);
  }
  // And checkout: an order in MY restaurant with SOMEBODY ELSE'S table.
  if (theirTable && mine) {
    const r5 = await fetch(BASE + "/api/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId: mine.id, tableId: theirTable, items: [] }),
    });
    if (r5.status >= 400) ok(`checkout refuses another restaurant's table (${r5.status})`);
    else bad(`checkout accepted another restaurant's table (${r5.status})`);
  }

  // Paying at the till is the restaurant's call, not the customer's phone. If
  // `payLater` could be claimed with the switch off, anyone could take food
  // without paying via the general QR — and nobody to bill for it.
  const { data: off } = await admin
    .from("restaurants").select("id, name")
    .eq("allow_pay_later", false).limit(1).maybeSingle();
  // With a real dish: an empty cart is refused for being empty, and that test
  // would pass even if the permission did not exist.
  const { data: dish } = await admin
    .from("menu_items").select("id, name, price")
    .eq("restaurant_id", off?.id ?? "").eq("available", true).limit(1).maybeSingle();
  if (off && dish) {
    const r6 = await fetch(BASE + "/api/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurantId: off.id, tableId: null, payLater: true,
        items: [{ itemId: dish.id, name: dish.name, price: dish.price, qty: 1, emoji: "🍽️", mods: {} }],
      }),
    });
    if (r6.status >= 400) ok(`checkout refuses pay-at-counter where it is off (${r6.status})`);
    else bad(`checkout allowed pay-at-counter where it is off (${r6.status})`);
  }
}


// ── Icon groups, belonging to the restaurant that made them ─────────────────
// The service key writes them, and it bypasses RLS: the only thing separating
// one owner's group from another is the route's `.eq("restaurant_id")`. And
// PostgREST does not complain when a filter matches nothing, so reading the
// status is not enough — look at the row again and see it is as it was.
if (!signIn.error && theirs) {
  console.log("\nIcon groups belonging to the restaurant next door");
  const cookie = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token=base64-${Buffer.from(JSON.stringify(signIn.data.session)).toString("base64")}`;

  const { data: victim } = await admin
    .from("icon_groups")
    .insert({ restaurant_id: theirs.id, variant: "addon", name: "probe-rls", sort_order: 99 })
    .select("id, name")
    .single();
  await admin.from("icon_group_items").insert({ group_id: victim.id, emoji: "🌮", sort_order: 0 });

  const call = async (method, body) => {
    const res = await fetch(BASE + "/api/icon-groups", {
      method, headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify(body),
    });
    return res.status;
  };

  const renamed = await call("PATCH", { id: victim.id, name: "secuestrado" });
  const { data: afterPatch } = await admin
    .from("icon_groups").select("name").eq("id", victim.id).maybeSingle();
  if (afterPatch?.name === "probe-rls") ok(`cannot rename another restaurant's icon group (${renamed})`);
  else bad(`renamed another restaurant's icon group (${renamed})`);

  const removed = await call("DELETE", { id: victim.id });
  const { data: afterDelete } = await admin
    .from("icon_groups").select("id").eq("id", victim.id).maybeSingle();
  if (afterDelete) ok(`cannot delete another restaurant's icon group (${removed})`);
  else bad(`deleted another restaurant's icon group (${removed})`);

  // The kitchen does not touch the menu: the route asks for management, not just a session.
  const kitchen = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const kSignIn = await kitchen.auth.signInWithPassword({
    email: "demo-kitchen@tabletap.dev", password: "demo123",
  });
  if (!kSignIn.error) {
    const kCookie = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token=base64-${Buffer.from(JSON.stringify(kSignIn.data.session)).toString("base64")}`;
    const res = await fetch(BASE + "/api/icon-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: kCookie },
      body: JSON.stringify({ name: "cocina", variant: "addon", icons: [{ emoji: "🌮" }] }),
    });
    if (res.status === 403) ok("kitchen cannot create icon groups (403)");
    else {
      bad(`kitchen created an icon group (${res.status})`);
      // If it really got in, delete by id — never by name: a `delete` by name in
      // production would take out somebody else's group.
      const { id } = await res.json().catch(() => ({}));
      if (id) await admin.from("icon_groups").delete().eq("id", id);
    }
  }

  // And their neighbour cannot read them with their own session either.
  verdict(
    `${mine.name} cannot read ${theirs.name}'s icon group items`,
    await asUser.from("icon_group_items").select("emoji").eq("group_id", victim.id).limit(1),
  );

  // ── The neighbour's dietary tags ────────────────────────────────────────
  // Public to read, nobody else's to write. And a deletion strips the tag off
  // the dishes, so another restaurant's id slipping past the filter would
  // detach tags from a menu that is not theirs.
  const { data: theirTag } = await admin
    .from("dietary_tags").select("id, key, label")
    .eq("restaurant_id", theirs.id).limit(1).maybeSingle();

  if (theirTag) {
    const renameTag = await fetch(BASE + "/api/dietary-tags", {
      method: "PATCH", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ id: theirTag.id, label: "secuestrada" }),
    });
    const { data: tagAfter } = await admin
      .from("dietary_tags").select("label").eq("id", theirTag.id).maybeSingle();
    if (tagAfter?.label === theirTag.label) ok(`cannot rename another restaurant's dietary tag (${renameTag.status})`);
    else bad(`renamed another restaurant's dietary tag (${renameTag.status})`);

    const dropTag = await fetch(BASE + "/api/dietary-tags", {
      method: "DELETE", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ id: theirTag.id }),
    });
    const { data: tagStill } = await admin
      .from("dietary_tags").select("id").eq("id", theirTag.id).maybeSingle();
    if (tagStill) ok(`cannot delete another restaurant's dietary tag (${dropTag.status})`);
    else bad(`deleted another restaurant's dietary tag (${dropTag.status})`);
  }

  // Collect the probe: nothing this check creates is left behind.
  await admin.from("icon_groups").delete().eq("id", victim.id);
}

// ── One tenant does not read the one next door ──────────────────────────────
// The row policy on `restaurants` shows every row — the menu hangs off a QR —
// so the only thing separating one restaurant from another is the column list.
// With SELECT on the whole table, the kitchen account could read the plan, the
// billing status and everyone's Stripe accounts.
{
  const staff = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  await staff.auth.signInWithPassword({ email: "demo-kitchen@tabletap.dev", password: "demo123" });

  for (const col of ["owner_id", "stripe_account_id", "stripe_customer_id", "plan_status"]) {
    const { data, error } = await staff.from("restaurants").select(col).limit(1);
    if (error || !data?.length) ok(`staff cannot read restaurants.${col}`);
    else bad(`staff read restaurants.${col} across every tenant`);
  }

  // And what is genuinely public stays public, timezone included: without it the
  // menu fell back to America/Mexico_City silently and opened at the wrong hour.
  const guest = anon;
  const { data: tz, error: tzErr } = await guest
    .from("restaurants").select("id, name, timezone").limit(1).maybeSingle();
  if (!tzErr && tz?.timezone) ok("anon reads the public menu columns, timezone included");
  else bad(`anon cannot read the menu's own columns (${tzErr?.message ?? "no timezone"})`);
}

// ── The kitchen cooks; it does not count the drawer ────────────────────────
//
// `payments` was readable by the whole team, the pass included. That was
// invisible while every payment was anonymous — once the ledger carried real
// amounts and the name of whoever took the cash, it meant a kitchen hand could
// read the restaurant's takings and see what each person on the floor had
// collected.
{
  const kitchen = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const { error: inErr } = await kitchen.auth.signInWithPassword({
    email: "demo-kitchen@tabletap.dev",
    password: "demo123",
  });
  if (inErr) {
    bad("cannot sign in as the kitchen — the takings check did not run");
  } else {
    const seen = await kitchen.from("payments").select("id").limit(1);
    (seen.error || (seen.data ?? []).length === 0)
      ? ok("the kitchen cannot read the takings")
      : bad("the kitchen reads payments — it can see what the floor collected");

    // And the floor still can, or the corte stops working for the people who
    // actually count the drawer.
    const floor = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
    await floor.auth.signInWithPassword({
      email: "demo-cashier@tabletap.dev",
      password: "demo123",
    });
    const paid = await floor.from("payments").select("id").limit(1);
    (!paid.error && (paid.data ?? []).length > 0)
      ? ok("a cashier still reads the takings they took")
      : bad("a cashier cannot read payments — the corte will not build");
  }
}

// ── Every table, every role, measured by effect ────────────────────────────
//
// The checks above name the leaks somebody thought of. This one names none: it
// walks every tenant-scoped table as every role and asks whether another
// restaurant's rows can be read or destroyed. It exists because each hand
// review found a different thing, which is a sign the reviewing should not be
// by hand.
//
// It measures EFFECT, never the absence of an error. A write RLS filters to
// zero rows returns no error at all, and reading that as "allowed" reported
// four tables as wide open that were all fine.
{
  console.log("\n  Every table, every role\n");

  const { data: rs } = await admin.from("restaurants").select("id,name");
  const home = rs.find(r => r.name === "Demo Bistro") ?? rs[0];
  const others = rs.filter(r => r.id !== home.id).map(r => r.id);

  // Deliberately public: a diner scanning a QR has no login and must be able to
  // read the menu. Every other tenant-scoped table must be invisible.
  const PUBLIC_MENU = ["categories", "dietary_tags", "menu_items", "menus", "promotions"];
  const TENANT = ["bill_splits", "categories", "coupon_redemptions", "coupons", "dietary_tags",
    "discount_requests", "dish_ratings", "icon_groups", "menu_items", "menus", "notifications",
    "orders", "payments", "print_jobs", "promotions", "restaurant_tables", "service_requests",
    "staff", "table_sessions", "user_logs", "write_off_requests"];
  const TEAM = [["anon", null], ["owner", "demo@tabletap.dev"], ["manager", "demo-manager@tabletap.dev"],
    ["waiter", "demo-waiter@tabletap.dev"], ["cashier", "demo-cashier@tabletap.dev"],
    ["kitchen", "demo-kitchen@tabletap.dev"]];

  if (others.length === 0) {
    bad("only one restaurant exists — cross-tenant checks cannot run");
  }

  // A neighbour with one of everything.
  //
  // Without a foreign row to reach for, the sweep passed on twelve of
  // twenty-one tables by finding nothing to attack — a green tick for a
  // question never asked, which is exactly how a leak survives a check that
  // "passed". Planted here, attacked below, removed after.
  //
  // Never against production. This plants rows, and production is somebody's
  // real accounting: a probe order and a probe payment there would show up in
  // their takings and in the corte. The sweep runs with whatever real data
  // production happens to hold, and says plainly what it therefore could not
  // reach.
  // Already planted, above, into the restaurant this sweep also attacks.
  if (!prod && !fixture?.planted.payment) {
    bad("no neighbour's payment was planted — orders/payments went unchecked");
  }

  // Which tables this sweep could actually bite on, so a silent gap is visible.
  const testable = [];
  for (const table of TENANT) {
    const { count } = await admin
      .from(table).select("id", { count: "exact", head: true }).in("restaurant_id", others);
    if ((count ?? 0) > 0) testable.push(table);
  }
  const untested = TENANT.filter(t => !testable.includes(t));
  console.log(`  ..       attacking ${testable.length}/${TENANT.length} tables that hold another restaurant's rows`);
  if (untested.length) console.log(`  ..       no fixture, so not attacked: ${untested.join(", ")}`);
  for (const must of ["orders", "payments", "menu_items", "staff"]) {
    if (testable.includes(must)) continue;
    // In development the fixture is planted, so a gap here is a real fault. In
    // production nothing may be planted, so it is a limit of the sweep and is
    // said out loud rather than counted as a pass.
    if (prod) console.log(`  ..       ${must} has no second restaurant's rows here — not attacked`);
    else bad(`${must} has no other restaurant's rows — this sweep proves nothing about it`);
  }

  for (const [role, email] of TEAM) {
    const who = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
    if (email) {
      const { error } = await who.auth.signInWithPassword({ email, password: "demo123" });
      if (error) { bad(`cannot sign in as ${role} — this role went unchecked`); continue; }
    }
    let reads = 0, writes = 0;
    for (const table of TENANT) {
      const seen = await who.from(table).select("id").in("restaurant_id", others).limit(1);
      if (!seen.error && seen.data?.length && !PUBLIC_MENU.includes(table)) {
        reads++; bad(`${role} reads ${table} belonging to another restaurant`);
      }
      // Try to destroy a real foreign row, then ask the secret key whether it survived.
      const { data: victim } = await admin
        .from(table).select("id").in("restaurant_id", others).limit(1).maybeSingle();
      if (!victim) continue;
      await who.from(table).delete().eq("id", victim.id);
      const { data: alive } = await admin.from(table).select("id").eq("id", victim.id).maybeSingle();
      if (!alive) { writes++; bad(`${role} DESTROYED a row of ${table} in another restaurant`); }
    }
    if (reads === 0 && writes === 0) {
      ok(`${role} reaches nothing of another restaurant's, by read or by write`);
    }
  }

}

// ── The other door: realtime ────────────────────────────────────────────────
//
// Everything above asks PostgREST. The kitchen board does not — it subscribes,
// and `orders` and `service_requests` are in the realtime publication. A row
// arriving down a socket has bypassed every check in this file if RLS does not
// reach that far, and nothing here had ever asked whether it does.
//
// Judged the only way a negative is worth anything: the channel is first shown
// to be live by receiving an event it IS entitled to, and only then asked for
// one it is not. Without that, "no payload arrived" and "realtime is off" look
// exactly alike — which is how this check would come to pass while proving
// nothing.
if (!prod) {
  console.log("\n  Realtime\n");

  const { data: rs2 } = await admin.from("restaurants").select("id, name");
  const mine = rs2.find(r => r.name === "Demo Bistro") ?? rs2[0];
  const theirs = rs2.find(r => r.id !== mine.id);
  const PROBE = "rls realtime probe";

  const listen = async (client, restaurantId) => {
    const seen = [];
    const channel = client
      .channel(`rls-${restaurantId}-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        payload => seen.push(payload.new?.id ?? payload.old?.id),
      );
    const status = await new Promise(resolve => {
      channel.subscribe(st => {
        if (["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(st)) resolve(st);
      });
      setTimeout(() => resolve("NO_STATUS"), 20000);
    });
    return { seen, status };
  };

  /**
   * Wait for what should arrive, not for a fixed number of seconds.
   *
   * A sleep long enough to be reliable is a sleep that makes the whole gate
   * slow, and one short enough to be quick fails on a slow afternoon — this
   * check reported a leak-free app as broken exactly once that way, which is
   * how a gate teaches people to ignore it. So: return the moment the event
   * lands, and only give up at the deadline.
   */
  const settle = async (seen, want, ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until && seen.length < want) await new Promise(r => setTimeout(r, 250));
    // A breath after the last one, so a SECOND payload that should not exist
    // still has time to show up and be counted.
    await new Promise(r => setTimeout(r, 750));
    return seen.length;
  };

  const plant = async restaurantId => {
    const { data } = await admin.from("orders").insert({
      restaurant_id: restaurantId, status: "received", paid: true, subtotal: 1,
      service_fee: 0, tip: 0, tax_pct: 0, total: 1, currency: "MXN", note: PROBE,
      items: [{ itemId: "x", name: PROBE, emoji: "x", price: 1, qty: 1, mods: {} }],
    }).select("id").maybeSingle();
    return data?.id ?? null;
  };

  const kitchen = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const { data: kitchenAuth, error: signInError } = await kitchen.auth.signInWithPassword({
    email: "demo-kitchen@tabletap.dev",
    password: "demo123",
  });
  // The socket is a separate connection with its own idea of who is asking,
  // and orders belong to the team under RLS. The client usually carries the
  // session across on its own — removing this line does not reproduce the
  // failure — but "usually" is what this check kept tripping over, and the app
  // states it outright in useLiveOrders. Stated here too, with the retry below
  // for the race that is actually left.
  if (kitchenAuth?.session) kitchen.realtime.setAuth(kitchenAuth.session.access_token);

  if (signInError) {
    bad(`cannot sign in as the kitchen — realtime went unchecked: ${signInError.message}`);
  } else if (!theirs) {
    bad("only one restaurant exists — the realtime check cannot run");
  } else {
    // 1. Live? Its own restaurant's ticket must arrive, or nothing below means
    //    anything.
    const own = await listen(kitchen, mine.id);
    // Planted twice if the first one does not arrive. SUBSCRIBED is the client
    // saying it asked, not the server saying it is wired up, and the gap
    // between the two is real — a first ticket can fall into it. A second one
    // a breath later cannot fall into the same gap, so one delivery out of two
    // proves the socket is live while a dead subscription still fails both.
    const ownId = await plant(mine.id);
    await settle(own.seen, 1, 20000);
    if (own.seen.length === 0) {
      // Cleaned by note with the rest of them, below.
      await plant(mine.id);
      await settle(own.seen, 1, 20000);
    }
    await kitchen.removeAllChannels();

    if (own.seen.length === 0) {
      bad(`realtime delivered nothing for the kitchen's own restaurant after two tickets (${own.status}) — the check below would prove nothing`);
    } else {
      ok("realtime reaches the board it belongs to");

      // 2. And now somebody else's, asked for by id — as staff elsewhere, and
      //    as nobody at all.
      // Nobody at all: no token on this one, deliberately.
      const anon = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      );
      const [asStaff, asAnon] = await Promise.all([listen(kitchen, theirs.id), listen(anon, theirs.id)]);
      const theirId = await plant(theirs.id);
      // Nothing SHOULD arrive here, so there is nothing to wait for: this is
      // the one place a fixed wait is right, and it is as long as the wait
      // above took to deliver, so a slow socket cannot pass for a safe one.
      await settle(asStaff.seen, 1, 12000);
      await Promise.all([kitchen.removeAllChannels(), anon.removeAllChannels()]);

      asStaff.seen.length === 0
        ? ok("a kitchen elsewhere hears nothing of another restaurant's orders")
        : bad(`realtime handed ${asStaff.seen.length} of another restaurant's orders to a signed-in kitchen`);
      asAnon.seen.length === 0
        ? ok("nobody at all hears them either")
        : bad(`realtime handed ${asAnon.seen.length} of another restaurant's orders to an anonymous listener`);

      if (theirId) await admin.from("orders").delete().eq("id", theirId);
    }
    if (ownId) await admin.from("orders").delete().eq("id", ownId);
  }
  // Whatever happened above, nothing of this is left behind.
  await admin.from("orders").delete().eq("note", PROBE);
}

if (fixture) await fixture.remove();

console.log(failed === 0 ? "\nNothing is exposed.\n" : `\n${failed} PROBLEM(S) — fix before shipping.\n`);
process.exit(failed === 0 ? 0 : 1);
