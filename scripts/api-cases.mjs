// ============================================================================
// Un caso por endpoint: la petición que SÍ debe funcionar.
//
// `pnpm rls` prueba a quién se le niega y `invariants` que exista un guardia.
// Ninguno prueba que una petición legítima haga lo suyo, y ese es el hueco por
// el que se colaron los errores que el usuario encontró antes que nosotros.
//
// `expect` es el estado que se considera sano. Varios endpoints dependen de
// Stripe y sin cuenta conectada su respuesta correcta es una negativa concreta
// (409, 400) — eso es funcionar. Lo que nunca está bien es un 500.
// ============================================================================
import { MARK } from "./api-fixtures.mjs";

/** Crear un cupón responde `{ ok: true }`, así que el id se busca donde vive. */
async function pendingWriteOff(fx) {
  const { data } = await fx.admin
    .from("write_off_requests").select("id")
    .eq("restaurant_id", fx.restaurant.id).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.id ?? "";
}

async function promoId(fx) {
  const { data } = await fx.admin
    .from("promotions").select("id")
    .eq("restaurant_id", fx.restaurant.id).like("name", `${MARK}%`)
    .limit(1).maybeSingle();
  return data?.id ?? "";
}

async function staffId(fx) {
  const { data } = await fx.admin
    .from("staff").select("id").eq("email", `${MARK}@tabletap.dev`).maybeSingle();
  return data?.id ?? "";
}

async function iconGroupId(fx) {
  const { data } = await fx.admin
    .from("icon_groups").select("id").eq("restaurant_id", fx.restaurant.id)
    .eq("name", `${MARK} iconos`).maybeSingle();
  return data?.id ?? "";
}

async function couponId(fx) {
  const { data } = await fx.admin
    .from("coupons").select("id").eq("restaurant_id", fx.restaurant.id)
    .eq("code", "API-001").maybeSingle();
  return data?.id ?? "";
}

export function cases(fx) {
  const { restaurant, table, dish, paidOrder, unpaidOrder, tableOrder, menu } = fx;
  const r = restaurant.id;

  return [
    // ── lo que toca el comensal, sin sesión ──────────────────────────────
    { name: "GET  /api/session", as: "diner", method: "GET",
      path: `/api/session?id=${fx.sessionId ?? ""}`, expect: fx.sessionId ? [200] : [400] },
    { name: "GET  /api/bill (mesa)", as: "diner", method: "GET",
      path: `/api/bill?restaurantId=${r}&tableId=${table.id}`, expect: [200] },
    { name: "GET  /api/order-status", as: "diner", method: "GET",
      path: `/api/order-status?id=${paidOrder}`, expect: [200] },
    { name: "POST /api/service-requests", as: "diner", method: "POST", path: "/api/service-requests",
      body: { restaurantId: r, tableId: table.id, kind: "waiter" }, expect: [200] },
    { name: "POST /api/ratings/pending", as: "diner", method: "POST", path: "/api/ratings/pending",
      body: { restaurantId: r, orderIds: [paidOrder] }, expect: [200],
      check: d => Array.isArray(d.dishes) && d.dishes.length > 0 || "no ofreció el platillo comprado" },
    { name: "POST /api/ratings", as: "diner", method: "POST", path: "/api/ratings",
      body: { restaurantId: r, ratings: [{ orderId: paidOrder, itemId: dish.id, rating: 5 }] },
      expect: [200], check: d => d.saved === 1 || `guardó ${d.saved}` },
    { name: "POST /api/coupons/validate", as: "diner", method: "POST", path: "/api/coupons/validate",
      body: { restaurantId: r, code: "API-001", subtotal: 100 }, expect: [200, 400, 404] },
    { name: "POST /api/checkout (tarjeta)", as: "diner", method: "POST", path: "/api/checkout",
      // Sin cuenta de Stripe conectada la respuesta sana es 409, no un 500.
      body: { restaurantId: r, tableId: null, items: [{ itemId: dish.id, name: dish.name,
        price: Number(dish.price), qty: 1, emoji: "🍽️", mods: {} }] }, expect: [200, 409] },
    { name: "POST /api/receipt", as: "diner", method: "POST", path: "/api/receipt",
      body: { orderId: paidOrder, email: "nadie@tabletap.dev" }, expect: [200, 400, 409, 503] },

    // ── el piso ──────────────────────────────────────────────────────────
    { name: "GET  /api/badges", as: "waiter", method: "GET", path: "/api/badges", expect: [200] },
    { name: "GET  /api/table-bill (mesa)", as: "waiter", method: "GET",
      path: `/api/table-bill?tableId=${table.id}`, expect: [200] },
    { name: "GET  /api/table-bill (mostrador)", as: "cashier", method: "GET",
      path: `/api/table-bill?orderId=${unpaidOrder}`, expect: [200],
      check: d => d.orders?.length === 1 || "no encontró el pedido de mostrador" },
    { name: "GET  /api/bill/discount/options", as: "manager", method: "GET",
      path: `/api/bill/discount/options?tableId=${table.id}`, expect: [200] },
    { name: "PATCH /api/orders (mover)", as: "kitchen", method: "PATCH", path: "/api/orders",
      body: { id: unpaidOrder, status: "preparing" }, expect: [200] },
    { name: "POST /api/table-payment (mostrador)", as: "cashier", method: "POST",
      path: "/api/table-payment", body: { orderId: unpaidOrder, settlement: "cash" },
      expect: [200], check: d => d.orders === 1 || `saldó ${d.orders} pedidos` },

    // ── gerencia ─────────────────────────────────────────────────────────
    { name: "POST /api/settings", as: "manager", method: "POST", path: "/api/settings",
      body: { accepting_orders: true }, expect: [200] },
    { name: "POST /api/coupons (crear)", as: "manager", method: "POST", path: "/api/coupons",
      body: { code: "API-001", kind: "percent", value: 10 }, expect: [200] },
    { name: "PATCH /api/coupons (apagar)", as: "manager", method: "PATCH", path: "/api/coupons",
      body: async f => ({ id: await couponId(f), active: false }), expect: [200] },
    { name: "DELETE /api/coupons", as: "manager", method: "DELETE", path: "/api/coupons",
      body: async f => ({ id: await couponId(f) }), expect: [200] },
    { name: "POST /api/icon-groups (crear)", as: "manager", method: "POST", path: "/api/icon-groups",
      body: { name: `${MARK} iconos`, variant: "addon", icons: [{ emoji: "🌮" }, { emoji: "🌶️" }] },
      expect: [200], check: d => Boolean(d.id) || "no devolvió el id del grupo" },
    { name: "PATCH /api/icon-groups (renombrar)", as: "manager", method: "PATCH", path: "/api/icon-groups",
      body: async f => ({ id: await iconGroupId(f), name: `${MARK} iconos`, icons: [{ emoji: "🧄" }] }),
      expect: [200] },
    { name: "DELETE /api/icon-groups", as: "manager", method: "DELETE", path: "/api/icon-groups",
      body: async f => ({ id: await iconGroupId(f) }), expect: [200] },
    { name: "POST /api/promotions (crear)", as: "manager", method: "POST", path: "/api/promotions",
      body: { kind: "bogo", name: `${MARK} 2x1`, emoji: "🎁", buyQty: 2, payQty: 1,
              items: [{ itemId: dish.id, qty: 1 }] }, expect: [200] },
    { name: "POST /api/legal/accept", as: "owner", method: "POST", path: "/api/legal/accept",
      body: {}, expect: [200] },
    { name: "GET  /api/connect/status", as: "owner", method: "GET", path: "/api/connect/status",
      expect: [200] },

    // ── la cuenta: descontar, cancelar, cobrar ───────────────────────────
    { name: "POST /api/bill/discount (mesero pide)", as: "waiter", method: "POST",
      path: "/api/bill/discount", body: { tableId: table.id, code: "API-002" },
      // Sin cupón válido la negativa correcta es 400; con uno, el mesero deja
      // una solicitud. Lo que no puede es reventar.
      expect: [200, 400, 403, 404] },
    { name: "POST /api/bill/write-off (mesero pide)", as: "waiter", method: "POST",
      path: "/api/bill/write-off", body: { tableId: table.id, reason: "walkout", note: MARK },
      expect: [200], check: d => d.pending === true || "la petición de un mesero debería quedar pendiente" },
    { name: "POST /api/bill/write-off/approve", as: "manager", method: "POST",
      path: "/api/bill/write-off/approve", body: async f => ({ id: await pendingWriteOff(f), approve: false }),
      expect: [200, 400, 404] },
    { name: "POST /api/orders/cancel", as: "owner", method: "POST", path: "/api/orders/cancel",
      body: { id: tableOrder }, expect: [200] },
    { name: "POST /api/bill/pay (en línea)", as: "diner", method: "POST", path: "/api/bill/pay",
      body: { restaurantId: r, tableId: table.id }, expect: [200, 400, 409] },

    // ── promociones: el resto de su vida ─────────────────────────────────
    { name: "PATCH /api/promotions (apagar)", as: "manager", method: "PATCH", path: "/api/promotions",
      body: async f => ({ id: await promoId(f), active: false }), expect: [200] },
    { name: "DELETE /api/promotions", as: "manager", method: "DELETE", path: "/api/promotions",
      body: async f => ({ id: await promoId(f) }), expect: [200] },

    // ── el equipo ────────────────────────────────────────────────────────
    // Invitar manda un correo por el servicio propio de Supabase, que sin SMTP
    // configurado rechaza direcciones válidas o topa a las pocas por hora. Hoy
    // un dueño NO puede dar de alta a su equipo: el equipo demo existe porque
    // el seed lo crea directo, no invitándolo.
    { name: "POST /api/staff (invitar)", as: "owner", method: "POST", path: "/api/staff",
      body: { email: `${MARK}@tabletap.dev`, role: "waiter" }, expect: [200],
      known: "Supabase sin SMTP: invitar por correo no funciona" },
    { name: "PATCH /api/staff (cambiar rol)", as: "owner", method: "PATCH", path: "/api/staff",
      body: async f => ({ id: await staffId(f), role: "cashier" }), expect: [200, 400, 404] },
    { name: "DELETE /api/staff", as: "owner", method: "DELETE", path: "/api/staff",
      body: async f => ({ id: await staffId(f) }), expect: [200, 400, 404] },

    // ── el webhook: sin firma no pasa ────────────────────────────────────
    { name: "POST /api/webhooks/stripe (sin firma)", as: "diner", method: "POST",
      path: "/api/webhooks/stripe", body: { type: "checkout.session.completed" },
      // Aceptar esto sería dejar que cualquiera marque pedidos como pagados.
      expect: [400, 401, 403] },

    // ── dueño: dinero y equipo ───────────────────────────────────────────
    { name: "POST /api/billing/portal", as: "owner", method: "POST", path: "/api/billing/portal",
      body: {}, expect: [200, 400, 409] },
    // 502 mientras Stripe Connect no esté configurado en la cuenta de la
    // plataforma: la ruta reporta el fallo de arriba en vez de tragárselo, que
    // es lo correcto. Cuando Connect exista, esto será 200.
    { name: "POST /api/connect/onboard", as: "owner", method: "POST", path: "/api/connect/onboard",
      body: {}, expect: [200, 400, 409, 502] },
  ];
}
