// ============================================================================
// The data and identities `pnpm api` needs.
//
// Everything it creates carries a mark and is deleted at the end: a test that
// leaves litter in the database is the one that later looks like a bug. (It
// happened: a test order with a made-up itemId ended up looking like a fault
// calificaciones.)
// ============================================================================
import { createClient } from "@supabase/supabase-js";

export const MARK = "apicheck";

export async function setup(env, base) {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];

  const cookieFor = async email => {
    const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    const { data, error } = await c.auth.signInWithPassword({ email, password: "demo123" });
    if (error) throw new Error(`no pude entrar como ${email}: ${error.message}`);
    return `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(data.session)).toString("base64")}`;
  };

  const who = {
    owner: await cookieFor("demo@tabletap.dev"),
    manager: await cookieFor("demo-manager@tabletap.dev"),
    waiter: await cookieFor("demo-waiter@tabletap.dev"),
    cashier: await cookieFor("demo-cashier@tabletap.dev"),
    kitchen: await cookieFor("demo-kitchen@tabletap.dev"),
    diner: "",
  };

  const { data: restaurant } = await admin
    .from("restaurants").select("*").eq("name", "Demo Bistro").maybeSingle();
  const { data: tables } = await admin
    .from("restaurant_tables").select("id, label").eq("restaurant_id", restaurant.id);
  const { data: dish } = await admin
    .from("menu_items").select("id, name, price, emoji")
    .eq("restaurant_id", restaurant.id).eq("available", true).eq("is_addon", false)
    // Ordered, so every run uses the same dish. Unordered with limit(1),
    // Postgres returns whichever row it likes and the suite quietly changes
    // what it is testing between runs.
    .order("name").limit(1).maybeSingle();
  const { data: menu } = await admin
    .from("menus").select("id").eq("restaurant_id", restaurant.id).limit(1).maybeSingle();

  // One paid order and one unpaid, ours, so the demo's are left alone.
  const line = { itemId: dish.id, name: dish.name, emoji: dish.emoji ?? "🍽️", price: Number(dish.price), qty: 1, mods: {} };
  const make = async extra => {
    const { data, error } = await admin.from("orders").insert({
      restaurant_id: restaurant.id, table_label: null, table_id: null,
      items: [line], subtotal: line.price, service_fee: 0, tip: 0, tax_pct: 0,
      discount: 0, total: line.price, note: MARK, status: "received", ...extra,
    }).select("id").single();
    if (error) throw new Error(`no pude crear el pedido de prueba: ${error.message}`);
    return data.id;
  };

  // An open table session, which is what /api/session asks for by id.
  const { data: session } = await admin
    .from("table_sessions").select("id")
    .eq("restaurant_id", restaurant.id).is("closed_at", null)
    .limit(1).maybeSingle();

  // How many service requests there were BEFORE, so only ours get deleted.
  const { count: serviceRequestBefore } = await admin
    .from("service_requests").select("*", { count: "exact", head: true })
    .eq("restaurant_id", restaurant.id).eq("status", "open");

  return {
    admin, base, who, restaurant, dish, menu, serviceRequestBefore,
    table: tables[0],
    sessionId: session?.id ?? null,
    paidOrder: await make({ paid: true }),
    unpaidOrder: await make({ paid: false }),
    // A bill with a table: discounts and cancellations are asked for by table.
    tableOrder: await make({ paid: false, table_id: tables[0].id, table_label: tables[0].label }),
  };
}

/** Everything marked goes, whatever happened to the tests. */
export async function teardown(fx) {
  const { admin, restaurant } = fx;
  await admin.from("dish_ratings").delete().in("order_id", [fx.paidOrder, fx.unpaidOrder]);
  await admin.from("orders").delete().eq("note", MARK);
  await admin.from("coupons").delete().eq("restaurant_id", restaurant.id).like("code", "API-%");
  // The waiter request the test creates carries a table. The filter said
  // `table_id is null` and deleted nothing: an open row was left on Table 1
  // that later showed up as a visual bug on the board. A test that leaves
  // litter is the one that later looks like a bug.
  if (fx.serviceRequestBefore !== undefined) {
    const { data: now } = await admin
      .from("service_requests").select("id")
      .eq("restaurant_id", restaurant.id).eq("status", "open")
      .order("created_at", { ascending: false });
    const extra = (now ?? []).slice(0, Math.max(0, (now ?? []).length - fx.serviceRequestBefore));
    if (extra.length) await admin.from("service_requests").delete().in("id", extra.map(x => x.id));
  }
  await admin.from("promotions").delete().eq("restaurant_id", restaurant.id).like("name", `${MARK}%`);
  await admin.from("icon_groups").delete().eq("restaurant_id", restaurant.id).like("name", `${MARK}%`);
  await admin.from("dietary_tags").delete().eq("restaurant_id", restaurant.id).like("key", `${MARK}%`);
  await admin.from("restaurant_tables").delete().eq("restaurant_id", restaurant.id).like("label", `${MARK}%`);
  await admin.from("write_off_requests").delete().eq("restaurant_id", restaurant.id).eq("note", MARK);
  // The test login: the row and the user holding it up.
  const { data: hired } = await admin.from("staff").select("user_id").eq("email", `${MARK}@tabletap.dev`).maybeSingle();
  await admin.from("staff").delete().eq("email", `${MARK}@tabletap.dev`);
  if (hired?.user_id) await admin.auth.admin.deleteUser(hired.user_id).catch(() => {});
}
