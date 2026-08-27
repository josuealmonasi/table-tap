// ============================================================================
// Los datos y las identidades que necesita `pnpm api`.
//
// Todo lo que crea lleva una marca y se borra al final: una prueba que deja
// basura en la base es la que después parece un bug. (Pasó: un pedido de
// prueba con un itemId inventado acabó pareciendo una falla del sistema de
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
    .limit(1).maybeSingle();
  const { data: menu } = await admin
    .from("menus").select("id").eq("restaurant_id", restaurant.id).limit(1).maybeSingle();

  // Un pedido pagado y otro sin pagar, nuestros, para no tocar los del demo.
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

  // Una sesión de mesa abierta, que es lo que /api/session pide por id.
  const { data: session } = await admin
    .from("table_sessions").select("id")
    .eq("restaurant_id", restaurant.id).is("closed_at", null)
    .limit(1).maybeSingle();

  // Cuántas peticiones de servicio había ANTES, para borrar sólo las nuestras.
  const { count: serviceRequestBefore } = await admin
    .from("service_requests").select("*", { count: "exact", head: true })
    .eq("restaurant_id", restaurant.id).eq("status", "open");

  return {
    admin, base, who, restaurant, dish, menu, serviceRequestBefore,
    table: tables[0],
    sessionId: session?.id ?? null,
    paidOrder: await make({ paid: true }),
    unpaidOrder: await make({ paid: false }),
    // Una cuenta con mesa: descuentos y cancelaciones se piden por mesa.
    tableOrder: await make({ paid: false, table_id: tables[0].id, table_label: tables[0].label }),
  };
}

/** Todo lo marcado se va, pase lo que pase con las pruebas. */
export async function teardown(fx) {
  const { admin, restaurant } = fx;
  await admin.from("dish_ratings").delete().in("order_id", [fx.paidOrder, fx.unpaidOrder]);
  await admin.from("orders").delete().eq("note", MARK);
  await admin.from("coupons").delete().eq("restaurant_id", restaurant.id).like("code", "API-%");
  // La petición de mesero que crea la prueba lleva mesa. El filtro decía
  // `table_id is null` y no borraba nada: quedó una fila abierta en Mesa 1 que
  // después apareció como un fallo visual en el tablero. Una prueba que deja
  // basura es la que luego parece un bug.
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
  await admin.from("restaurant_tables").delete().eq("restaurant_id", restaurant.id).like("label", `${MARK}%`);
  await admin.from("write_off_requests").delete().eq("restaurant_id", restaurant.id).eq("note", MARK);
  // El acceso de prueba: la fila y el usuario que la sostiene.
  const { data: hired } = await admin.from("staff").select("user_id").eq("email", `${MARK}@tabletap.dev`).maybeSingle();
  await admin.from("staff").delete().eq("email", `${MARK}@tabletap.dev`);
  if (hired?.user_id) await admin.auth.admin.deleteUser(hired.user_id).catch(() => {});
}
