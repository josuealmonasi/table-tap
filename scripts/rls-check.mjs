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

// Las etiquetas de dieta sí son públicas: salen en el platillo y filtran el
// menú. Lo que se prueba aquí es que se puedan leer — si el permiso se cayera,
// la carta perdería los alérgenos sin que nada se quejara.
{
  const { data, error } = await anon.from("dietary_tags").select("key, label, emoji").limit(1);
  if (!error && data?.length) ok("reads the dietary tags the menu shows");
  else bad(`cannot read dietary_tags (${error?.message ?? "sin filas"})`);
}

// ── 2. Privileged functions ────────────────────────────────────────────────
console.log("\nFunctions only the server may call");
for (const [fn, args] of [
  ["open_table_session", { p_restaurant: crypto.randomUUID(), p_table: crypto.randomUUID(), p_max_hours: 8 }],
  ["close_session_if_clear", { p_session: crypto.randomUUID(), p_reason: "paid" }],
  ["claim_founding_price", { p_restaurant: crypto.randomUUID(), p_limit: 50 }],
  ["redeem_coupon", { p_coupon_id: crypto.randomUUID() }],
  ["rate_limit_hit", { p_bucket: "probe", p_window_seconds: 60 }],
]) {
  const { error } = await anon.rpc(fn, args);
  if (error) ok(`anon cannot call ${fn}()`);
  else bad(`anon called ${fn}()`);
}

// ── 3. One restaurant reaching another ─────────────────────────────────────
console.log("\nA signed-in restaurant reaching another's data");
const { data: restaurants } = await admin.from("restaurants").select("id, name, owner_id").limit(3);
const mine = restaurants?.[0];
const theirs = restaurants?.find(r => r.id !== mine?.id);

const asUser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
const owner = users?.users?.find(u => u.id === mine?.owner_id);
const signIn = owner
  ? await asUser.auth.signInWithPassword({ email: owner.email, password: "test123" })
  : { error: new Error("no owner") };
if (signIn.error) {
  console.log(`  SKIPPED  could not sign in as ${owner?.email ?? "an owner"} (${signIn.error.message})`);
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
// Es el caso realista: no un extraño, sino un cliente nuestro con sesión
// válida que manda el id de otro local.
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
    // El endpoint acota por el restaurante del actor, así que debe venir vacío.
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
  // Y el checkout: pedido en MI restaurante con la mesa de OTRO.
  if (theirTable && mine) {
    const r5 = await fetch(BASE + "/api/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId: mine.id, tableId: theirTable, items: [] }),
    });
    if (r5.status >= 400) ok(`checkout refuses another restaurant's table (${r5.status})`);
    else bad(`checkout accepted another restaurant's table (${r5.status})`);
  }

  // Pagar en la caja lo decide el restaurante, no el teléfono del cliente. Si
  // se pudiera reclamar `payLater` con el interruptor apagado, cualquiera se
  // llevaría comida sin pagar por el QR general — y nadie a quien cobrarle.
  const { data: off } = await admin
    .from("restaurants").select("id, name")
    .eq("allow_counter_payment", false).eq("allow_pay_later", false).limit(1).maybeSingle();
  // Con un platillo de verdad: un carrito vacío se rechaza por vacío, y esa
  // prueba pasaría igual aunque el permiso no existiera.
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


// ── Los grupos de iconos, del restaurante que los hizo ───────────────────────
// Los escribe la llave de servicio, que salta la RLS: lo único que separa un
// grupo de otro dueño es el `.eq("restaurant_id")` de la ruta. Y PostgREST no
// se queja cuando un filtro no encuentra nada, así que aquí no basta con leer
// el status — hay que volver a mirar la fila y ver que sigue como estaba.
if (!signIn.error && theirs) {
  console.log("\nIcon groups belonging to the restaurant next door");
  const cookie = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}-auth-token=base64-${Buffer.from(JSON.stringify(signIn.data.session)).toString("base64")}`;

  const { data: victim } = await admin
    .from("icon_groups")
    .insert({ restaurant_id: theirs.id, variant: "addon", name: "sonda-rls", sort_order: 99 })
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
  if (afterPatch?.name === "sonda-rls") ok(`cannot rename another restaurant's icon group (${renamed})`);
  else bad(`renamed another restaurant's icon group (${renamed})`);

  const removed = await call("DELETE", { id: victim.id });
  const { data: afterDelete } = await admin
    .from("icon_groups").select("id").eq("id", victim.id).maybeSingle();
  if (afterDelete) ok(`cannot delete another restaurant's icon group (${removed})`);
  else bad(`deleted another restaurant's icon group (${removed})`);

  // La cocina no toca la carta: la ruta pide gerencia, no sólo sesión.
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
      // Si de verdad entró, se borra por id — nunca por nombre: un `delete`
      // por nombre en producción se llevaría por delante el grupo de alguien.
      const { id } = await res.json().catch(() => ({}));
      if (id) await admin.from("icon_groups").delete().eq("id", id);
    }
  }

  // Y su vecino tampoco puede leerlos con su propia sesión.
  verdict(
    `${mine.name} cannot read ${theirs.name}'s icon group items`,
    await asUser.from("icon_group_items").select("emoji").eq("group_id", victim.id).limit(1),
  );

  // ── Las etiquetas de dieta del vecino ──────────────────────────────────
  // Son públicas de leer, pero de nadie más para escribir. Y una baja se lleva
  // por delante la etiqueta de los platillos, así que un id ajeno que pasara
  // el filtro despegaría etiquetas de una carta que no es suya.
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

  // Se recoge la sonda: nada de lo que crea esta revisión se queda.
  await admin.from("icon_groups").delete().eq("id", victim.id);
}

// ── Un inquilino no lee al de al lado ────────────────────────────────────────
// La política de fila de `restaurants` deja ver todas las filas —el menú cuelga
// de un QR— así que lo único que separa a un restaurante de otro es la lista de
// columnas. Con SELECT sobre la tabla entera, la cuenta de cocina leía el plan,
// el estado de cobro y las cuentas de Stripe de todos.
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

  // Y lo que sí es público sigue siéndolo, incluida la zona horaria: sin ella
  // el menú caía en America/Mexico_City calladamente y abría a deshora.
  const guest = anon;
  const { data: tz, error: tzErr } = await guest
    .from("restaurants").select("id, name, timezone").limit(1).maybeSingle();
  if (!tzErr && tz?.timezone) ok("anon reads the public menu columns, timezone included");
  else bad(`anon cannot read the menu's own columns (${tzErr?.message ?? "sin timezone"})`);
}

console.log(failed === 0 ? "\nNothing is exposed.\n" : `\n${failed} PROBLEM(S) — fix before shipping.\n`);
process.exit(failed === 0 ? 0 : 1);
