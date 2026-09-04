// ============================================================================
// One case per endpoint: the request that SHOULD work.
//
// `pnpm rls` tests who gets refused and `invariants` that a guard exists.
// Neither tests that a legitimate request does its job, and that is the gap the
// bugs the user found before we did came through.
//
// `expect` is the state considered healthy. Several endpoints depend on Stripe,
// and with no connected account their correct answer is a specific refusal
// (409, 400) — that is working. What is never right is a 500.
// ============================================================================
import { MARK } from "./api-fixtures.mjs";

/** Creating a coupon answers `{ ok: true }`, so the id is looked up where it lives. */
async function pendingWriteOff(fx) {
  const { data } = await fx.admin
    .from("write_off_requests").select("id")
    .eq("restaurant_id", fx.restaurant.id).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.id ?? "";
}

async function pendingDiscount(fx) {
  const { data } = await fx.admin
    .from("discount_requests").select("id")
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

async function dietaryTagId(fx) {
  const { data } = await fx.admin
    .from("dietary_tags").select("id").eq("restaurant_id", fx.restaurant.id)
    .eq("key", `${MARK}_dieta`).maybeSingle();
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
    // ── what the diner touches, with no session ──────────────────────────
    { name: "GET  /api/session", as: "diner", method: "GET",
      path: `/api/session?id=${fx.sessionId ?? ""}`, expect: fx.sessionId ? [200] : [400] },
    { name: "GET  /api/bill (table)", as: "diner", method: "GET",
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
    { name: "GET  /api/order-qr", as: "diner", method: "GET",
      path: `/api/order-qr?id=${paidOrder}`, expect: [200],
      // A 200 with an empty body would be exactly the failure this file exists
      // to catch: staff would point a camera at nothing.
      checkText: t => t.startsWith("<svg") || `answered ${t.slice(0, 40)}` },
    // ── dividing a bill ───────────────────────────────────────────────────
    // The read is real. The writes are checked by the refusals they must give:
    // proposing one for real would leave a live split on the demo table, and
    // `pnpm api:prod` would leave it on a real one.
    { name: "GET  /api/split (nothing going on)", as: "diner", method: "GET",
      path: `/api/split?sessionId=${fx.sessionId ?? ""}&diner=apicheck&restaurantId=${r}&tableId=${table.id}`,
      expect: [200, 400] },
    { name: "POST /api/split (refuses one person)", as: "diner", method: "POST", path: "/api/split",
      body: { sessionId: fx.sessionId ?? "", diner: "apicheck", restaurantId: r, tableId: table.id, shares: 1 },
      expect: [400] },
    { name: "POST /api/split/join (no such split)", as: "diner", method: "POST", path: "/api/split/join",
      body: { splitId: "00000000-0000-0000-0000-000000000000", sessionId: fx.sessionId ?? "",
              diner: "apicheck", restaurantId: r, tableId: table.id },
      expect: [409] },
    { name: "POST /api/split/pay (no such split)", as: "diner", method: "POST", path: "/api/split/pay",
      body: { splitId: "00000000-0000-0000-0000-000000000000", sessionId: fx.sessionId ?? "",
              diner: "apicheck", restaurantId: r, tableId: table.id },
      expect: [409] },
    { name: "POST /api/checkout (tarjeta)", as: "diner", method: "POST", path: "/api/checkout",
      // With no Stripe account connected the healthy answer is 409, not a 500.
      //
      // Three of them, not one: Stripe will not take a card payment under
      // MX$10, and the cheapest dish on the demo menu is MX$6.50. At qty 1
      // this case was testing Stripe's floor rather than our checkout, and
      // whether it passed depended on which dish the fixture happened to pick.
      body: { restaurantId: r, tableId: null, items: [{ itemId: dish.id, name: dish.name,
        price: Number(dish.price), qty: 3, emoji: "🍽️", mods: {} }] }, expect: [200, 409] },
    { name: "POST /api/receipt", as: "diner", method: "POST", path: "/api/receipt",
      body: { orderId: paidOrder, email: "nadie@tabletap.dev" }, expect: [200, 400, 409, 503] },

    // ── el piso ──────────────────────────────────────────────────────────
    { name: "GET  /api/badges", as: "waiter", method: "GET", path: "/api/badges", expect: [200] },
    // The bell. A manager may read it and mark it read; that the floor and the
    // kitchen are refused is checked by `pnpm roles`, which owns the question
    // of who may call what.
    { name: "GET  /api/notifications", as: "manager", method: "GET",
      path: "/api/notifications", expect: [200],
      check: d => Array.isArray(d.notifications) || "did not answer with a list" },
    { name: "POST /api/notifications (all read)", as: "manager", method: "POST",
      path: "/api/notifications", body: { all: true }, expect: [200] },
    { name: "GET  /api/table-bill (table)", as: "waiter", method: "GET",
      path: `/api/table-bill?tableId=${table.id}`, expect: [200] },
    { name: "GET  /api/table-bill (counter)", as: "cashier", method: "GET",
      path: `/api/table-bill?orderId=${unpaidOrder}`, expect: [200],
      check: d => d.orders?.length === 1 || "no encontró el pedido de mostrador" },
    { name: "GET  /api/bill/discount/options", as: "manager", method: "GET",
      path: `/api/bill/discount/options?tableId=${table.id}`, expect: [200] },
    { name: "PATCH /api/orders (move)", as: "kitchen", method: "PATCH", path: "/api/orders",
      body: { id: unpaidOrder, status: "preparing" }, expect: [200] },
    { name: "POST /api/table-payment (counter)", as: "cashier", method: "POST",
      path: "/api/table-payment", body: { orderId: unpaidOrder, settlement: "cash" },
      expect: [200], check: d => d.orders === 1 || `saldó ${d.orders} pedidos` },

    // ── gerencia ─────────────────────────────────────────────────────────
    { name: "POST /api/settings", as: "manager", method: "POST", path: "/api/settings",
      body: { accepting_orders: true }, expect: [200] },
    { name: "POST /api/coupons (create)", as: "manager", method: "POST", path: "/api/coupons",
      body: { code: "API-001", kind: "percent", value: 10 }, expect: [200] },
    { name: "PATCH /api/coupons (switch off)", as: "manager", method: "PATCH", path: "/api/coupons",
      body: async f => ({ id: await couponId(f), active: false }), expect: [200] },
    { name: "DELETE /api/coupons", as: "manager", method: "DELETE", path: "/api/coupons",
      body: async f => ({ id: await couponId(f) }), expect: [200] },
    { name: "POST /api/dietary-tags (create)", as: "manager", method: "POST", path: "/api/dietary-tags",
      body: { label: `${MARK} dieta`, labelEn: "apicheck diet", emoji: "🍬" },
      expect: [200], check: d => Boolean(d.id) || "no devolvió el id de la etiqueta" },
    { name: "PATCH /api/dietary-tags (rename)", as: "manager", method: "PATCH", path: "/api/dietary-tags",
      body: async f => ({ id: await dietaryTagId(f), label: `${MARK} dieta`, emoji: "🍭" }),
      expect: [200] },
    { name: "DELETE /api/dietary-tags", as: "manager", method: "DELETE", path: "/api/dietary-tags",
      body: async f => ({ id: await dietaryTagId(f) }), expect: [200] },
    { name: "POST /api/icon-groups (create)", as: "manager", method: "POST", path: "/api/icon-groups",
      body: { name: `${MARK} iconos`, variant: "addon", icons: [{ emoji: "🌮" }, { emoji: "🌶️" }] },
      expect: [200], check: d => Boolean(d.id) || "no devolvió el id del grupo" },
    { name: "PATCH /api/icon-groups (rename)", as: "manager", method: "PATCH", path: "/api/icon-groups",
      body: async f => ({ id: await iconGroupId(f), name: `${MARK} iconos`, icons: [{ emoji: "🧄" }] }),
      expect: [200] },
    { name: "DELETE /api/icon-groups", as: "manager", method: "DELETE", path: "/api/icon-groups",
      body: async f => ({ id: await iconGroupId(f) }), expect: [200] },
    { name: "POST /api/promotions (create)", as: "manager", method: "POST", path: "/api/promotions",
      body: { kind: "bogo", name: `${MARK} 2x1`, emoji: "🎁", buyQty: 2, payQty: 1,
              items: [{ itemId: dish.id, qty: 1 }] }, expect: [200] },
    { name: "POST /api/legal/accept", as: "owner", method: "POST", path: "/api/legal/accept",
      body: {}, expect: [200] },
    { name: "GET  /api/connect/status", as: "owner", method: "GET", path: "/api/connect/status",
      expect: [200] },

    // ── the bill: discount, cancel, collect ──────────────────────────────
    { name: "POST /api/bill/discount (waiter asks)", as: "waiter", method: "POST",
      path: "/api/bill/discount", body: { tableId: table.id, code: "API-002" },
      // With no valid coupon the correct refusal is 400; with one, the waiter
      // leaves a request. What it must not do is blow up.
      expect: [200, 400, 403, 404] },
    { name: "POST /api/bill/discount/approve", as: "manager", method: "POST",
      path: "/api/bill/discount/approve",
      body: async f => ({ requestId: await pendingDiscount(f), approve: true }),
      // 400 with no request pending, 409 if it was already decided. Never a 500.
      expect: [200, 400, 409] },
    { name: "POST /api/bill/write-off (waiter asks)", as: "waiter", method: "POST",
      path: "/api/bill/write-off", body: { tableId: table.id, reason: "walkout", note: MARK },
      expect: [200], check: d => d.pending === true || "la petición de un mesero debería quedar pendiente" },
    { name: "POST /api/bill/write-off/approve", as: "manager", method: "POST",
      path: "/api/bill/write-off/approve", body: async f => ({ id: await pendingWriteOff(f), approve: false }),
      expect: [200, 400, 404] },
    { name: "POST /api/orders/cancel", as: "owner", method: "POST", path: "/api/orders/cancel",
      body: { id: tableOrder }, expect: [200] },
    { name: "POST /api/bill/pay (online)", as: "diner", method: "POST", path: "/api/bill/pay",
      body: { restaurantId: r, tableId: table.id }, expect: [200, 400, 409] },

    // ── promotions: the rest of their life ───────────────────────────────
    { name: "PATCH /api/promotions (switch off)", as: "manager", method: "PATCH", path: "/api/promotions",
      body: async f => ({ id: await promoId(f), active: false }), expect: [200] },
    { name: "DELETE /api/promotions", as: "manager", method: "DELETE", path: "/api/promotions",
      body: async f => ({ id: await promoId(f) }), expect: [200] },

    // ── el equipo ────────────────────────────────────────────────────────
    // Inviting sends mail through Supabase's own service, which without SMTP
    // configured refuses valid addresses or caps at a few per hour. Today an owner
    // CANNOT add their team: the demo team exists because the seed creates it
    // directly, not by invitation.
    { name: "POST /api/staff (invite)", as: "owner", method: "POST", path: "/api/staff",
      body: { email: `${MARK}@tabletap.dev`, role: "waiter" }, expect: [200],
      known: "Supabase sin SMTP: invitar por correo no funciona" },
    { name: "PATCH /api/staff (change role)", as: "owner", method: "PATCH", path: "/api/staff",
      body: async f => ({ id: await staffId(f), role: "cashier" }), expect: [200, 400, 404] },
    { name: "DELETE /api/staff", as: "owner", method: "DELETE", path: "/api/staff",
      body: async f => ({ id: await staffId(f) }), expect: [200, 400, 404] },

    // ── the webhook: no signature, no entry ──────────────────────────────
    { name: "POST /api/webhooks/stripe (no signature)", as: "diner", method: "POST",
      path: "/api/webhooks/stripe", body: { type: "checkout.session.completed" },
      // Accepting this would let anyone mark orders as paid.
      expect: [400, 401, 403] },

    // ── owner: money and team ────────────────────────────────────────────
    { name: "POST /api/billing/portal", as: "owner", method: "POST", path: "/api/billing/portal",
      body: {}, expect: [200, 400, 409] },
    // 502 while Stripe Connect is not configured on the platform account: the
    // route reports the upstream failure instead of swallowing it, which is
    // correct. Once Connect exists, this will be a 200.
    { name: "POST /api/connect/onboard", as: "owner", method: "POST", path: "/api/connect/onboard",
      body: {}, expect: [200, 400, 409, 502] },
    { name: "POST /api/billing/checkout", as: "owner", method: "POST", path: "/api/billing/checkout",
      body: { plan: "servicio" }, expect: [200, 400, 409, 502] },

    // ── the routes that destroy things: checked by their refusal ─────────
    //
    // These delete restaurants, delete logins and cancel subscriptions. A case
    // that exercised them for real would be a case that wrecks the demo
    // restaurant, and `pnpm api:prod` would do it to production. What matters
    // and what is safe to assert is the same thing: who is turned away.
    { name: "POST /api/billing/cancel (waiter refused)", as: "waiter", method: "POST",
      path: "/api/billing/cancel", body: {}, expect: [401, 403] },
    { name: "POST /api/admin/users (manager refused)", as: "manager", method: "POST",
      path: "/api/admin/users",
      body: { email: "nobody@tabletap.dev", password: "not-a-real-one", role: "admin" },
      expect: [401, 403] },
    { name: "DELETE /api/admin/restaurants (manager refused)", as: "manager", method: "DELETE",
      path: "/api/admin/restaurants", body: async f => ({ id: f.restaurant.id }),
      expect: [401, 403] },
    { name: "POST /api/signup (rejects an empty form)", as: "diner", method: "POST",
      path: "/api/signup", body: {}, expect: [400, 429] },
  ];
}
