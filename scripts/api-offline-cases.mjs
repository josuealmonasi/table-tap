import { createHmac } from "node:crypto";
import { MARK } from "./api-fixtures.mjs";

/** A test till opened online before its one-hour outage. The actual route
 * checks this proof; changing the production format must fail this probe. */
function contextFor(f, currency) {
  const issuedAt = Date.parse(f.offlineAt);
  const body = Buffer.from(JSON.stringify({ restaurantId: f.restaurant.id, collector: "demo-cashier@tabletap.dev",
    currency, issuedAt, until: issuedAt + 12 * 60 * 60_000 })).toString("base64url");
  return `${body}.${createHmac("sha256", process.env.SUPABASE_SECRET_KEY).update(`offline-collector-v1|${body}`).digest("base64url")}`;
}

export function offlineCases(fx) {
  const r = fx.restaurant.id;
  return [
    // ── A till sale rung without a connection, sent once it returns ───────
    // Recorded as it happened once its price and identity agree: at its own time, for what was collected,
    // finished. On a dish whose stock is not counted, because a stock taken
    // offline is not given back when the case's sale is deleted at teardown.
    { name: "POST /api/pos/order (an offline cash sale, sent an hour later)", as: "cashier", method: "POST",
      path: "/api/pos/order",
      arrange: async f => {
        const { data } = await f.admin.from("menu_items").select("id, name, price, emoji")
          .eq("restaurant_id", r).is("stock", null).eq("is_addon", false).eq("available", true)
          .eq("modifiers", "[]").eq("discount_pct", 0).limit(1).single();
        f.offlineDish = data;
        f.offlineRef = crypto.randomUUID();
        f.offlineAt = new Date(Date.now() - 3600_000).toISOString();
        f.offlineContext = contextFor(f, f.restaurant.currency);
        const sub = Number(data.price);
        const fee = f.restaurant.service_enabled ? Math.round(sub * Number(f.restaurant.service_pct)) / 100 : 0;
        f.offlineCharge = { at: f.offlineAt, subtotal: sub, serviceFee: fee, tip: 0, discount: 0, total: Math.round((sub + fee) * 100) / 100 };
      },
      body: f => ({
        restaurantId: r, currency: f.restaurant.currency, collectorContext: f.offlineContext, posRef: f.offlineRef, method: "cash", note: `${MARK} offline`, noReceipt: true, offline: f.offlineCharge,
        items: [{ itemId: f.offlineDish.id, name: f.offlineDish.name, price: Number(f.offlineDish.price), qty: 1, emoji: "🍽️", mods: {} }],
      }),
      expect: [200],
      check: async (d, f) => {
        const [{ data: o }, { data: pays }] = await Promise.all([
          f.admin.from("orders").select("id, status, paid, total, created_at, offline_at, offline_drift").eq("id", f.offlineRef).maybeSingle(),
          f.admin.from("payments").select("amount, method, created_at, actor_email").eq("order_id", f.offlineRef),
        ]);
        const sameTime = (iso) => Math.abs(Date.parse(iso) - Date.parse(f.offlineAt)) < 1000;
        if (d.orderId !== f.offlineRef) return `the sale's id is ${d.orderId}, not its reference`;
        if (!(o?.status === "completed" && o.paid && sameTime(o.created_at) && sameTime(o.offline_at) && Number(o.offline_drift) === 0)) {
          return `the order is ${JSON.stringify(o)}`;
        }
        return pays?.length === 1 && Number(pays[0].amount) === Number(o.total) && sameTime(pays[0].created_at)
          && pays[0].method === "cash" && pays[0].actor_email === "demo-cashier@tabletap.dev" || `paid ${JSON.stringify(pays)}`;
      } },
    { name: "POST /api/pos/order (the same offline sale sent again)", as: "cashier", method: "POST",
      path: "/api/pos/order",
      body: f => ({
        restaurantId: r, currency: f.restaurant.currency, collectorContext: f.offlineContext, posRef: f.offlineRef, method: "cash", note: `${MARK} offline`, noReceipt: true, offline: f.offlineCharge,
        items: [{ itemId: f.offlineDish.id, name: f.offlineDish.name, price: Number(f.offlineDish.price), qty: 1, emoji: "🍽️", mods: {} }],
      }),
      expect: [200],
      check: async (d, f) => {
        const { count } = await f.admin.from("payments").select("id", { count: "exact", head: true }).eq("order_id", f.offlineRef);
        return d.repeat === true && count === 1 || `answered ${JSON.stringify(d)}, ${count} payment(s)`;
      } },
    { name: "POST /api/pos/order (offline, collected more than today's menu)", as: "cashier", method: "POST",
      path: "/api/pos/order",
      body: f => ({
        restaurantId: r, currency: f.restaurant.currency, collectorContext: f.offlineContext, posRef: crypto.randomUUID(), method: "card", note: `${MARK} offline drift`, noReceipt: true, terminalRef: "AUT 7",
        offline: { ...f.offlineCharge, subtotal: f.offlineCharge.subtotal + 5, total: Math.round((f.offlineCharge.total + 5) * 100) / 100 },
        items: [{ itemId: f.offlineDish.id, name: f.offlineDish.name, price: Number(f.offlineDish.price), qty: 1, emoji: "🍽️", mods: {} }],
      }),
      expect: [200],
      check: async (d, f) => {
        f.offlineDriftRef = d.orderId;
        const [{ data: q }, { data: o }] = await Promise.all([
          f.admin.from("offline_sale_queue").select("body, collector, approved_at").eq("pos_ref", d.orderId).single(),
          f.admin.from("orders").select("id").eq("id", d.orderId).maybeSingle(),
        ]);
        return d.queued === true && q?.collector === "demo-cashier@tabletap.dev" && !q.approved_at && !o
          || `not queued for approval: ${JSON.stringify(d)}`;
      } },
    { name: "POST /api/pos/recover (manager preserves the actual collected amount)", as: "manager", method: "POST", path: "/api/pos/recover",
      body: f => ({ posRef: f.offlineDriftRef, restaurantId: r, approval: { confirmed: true, reason: "Original receipt and terminal voucher checked" } }),
      expect: [200], check: async (d, f) => {
        const [{ data: o }, { data: p }, { data: q }] = await Promise.all([
          f.admin.from("orders").select("offline_drift, total, offline_collector, offline_approved_by").eq("id", d.orderId).single(),
          f.admin.from("payments").select("amount, terminal_ref, actor_email").eq("order_id", d.orderId).single(),
          f.admin.from("offline_sale_queue").select("approved_at").eq("pos_ref", d.orderId).single(),
        ]);
        return d.settled === true && Number(o?.offline_drift) === 5 && Number(p?.amount) === Number(o.total) && p?.terminal_ref === "AUT 7"
          && p.actor_email === "demo-cashier@tabletap.dev" && o.offline_approved_by === "demo-manager@tabletap.dev" && Boolean(q?.approved_at)
          || `order ${JSON.stringify(o)}, payment ${JSON.stringify(p)}`;
      } },
    { name: "POST /api/pos/order (offline, on an account)", as: "cashier", method: "POST",
      path: "/api/pos/order",
      body: f => ({ posRef: crypto.randomUUID(), method: "account", accountId: fx.accountId, offline: f.offlineCharge,
        items: [{ itemId: f.offlineDish.id, name: "x", price: 1, qty: 1, mods: {} }] }),
      expect: [400], expectError: /efectivo o con tu terminal|cash and card-on-terminal/i },
    { name: "POST /api/pos/order (offline, forty days ago)", as: "cashier", method: "POST",
      path: "/api/pos/order",
      body: f => ({ restaurantId: r, posRef: crypto.randomUUID(), method: "cash", note: `${MARK} offline old`,
        offline: { ...f.offlineCharge, at: new Date(Date.now() - 40 * 86_400_000).toISOString() },
        items: [{ itemId: f.offlineDish.id, name: "x", price: 1, qty: 1, mods: {} }] }),
      expect: [200], check: async (d, f) => {
        f.offlineLegacyRef = d.orderId;
        const { data: q } = await f.admin.from("offline_sale_queue").select("collector, approved_at").eq("pos_ref", d.orderId).single();
        return d.queued === true && q?.collector === null && !q?.approved_at || "old receipt was not queued for attestation";
      } },
    { name: "POST /api/pos/recover (legacy receipt requires an explicit original collector)", as: "manager", method: "POST", path: "/api/pos/recover",
      body: f => ({ posRef: f.offlineLegacyRef, restaurantId: r, approval: { confirmed: true, reason: "Original receipt and drawer checked", currency: f.restaurant.currency } }),
      expect: [409] },
    { name: "POST /api/pos/recover (old legacy receipt with manager attestation)", as: "manager", method: "POST", path: "/api/pos/recover",
      body: f => ({ posRef: f.offlineLegacyRef, restaurantId: r, approval: { confirmed: true, reason: "Original receipt and drawer checked",
        collector: "demo-cashier@tabletap.dev", currency: f.restaurant.currency } }), expect: [200],
      check: async (d, f) => {
        const { data: p } = await f.admin.from("payments").select("actor_email, created_at").eq("order_id", d.orderId).single();
        return d.settled === true && p?.actor_email === "demo-cashier@tabletap.dev" && Date.parse(p.created_at) < Date.now() - 39 * 86_400_000
          || "legacy collection was not preserved";
      } },
    { name: "POST /api/pos/order (original foreign currency is received for review)", as: "cashier", method: "POST", path: "/api/pos/order",
      body: f => {
        f.offlineForeignCurrency = f.restaurant.currency === "MXN" ? "USD" : "MXN";
        return { restaurantId: r, posRef: crypto.randomUUID(), currency: f.offlineForeignCurrency, collectorContext: contextFor(f, f.offlineForeignCurrency),
          method: "cash", note: `${MARK} offline foreign`, offline: f.offlineCharge,
          items: [{ itemId: f.offlineDish.id, name: f.offlineDish.name, price: Number(f.offlineDish.price), qty: 1, mods: {} }] };
      }, expect: [200], check: async (d, f) => { f.offlineForeignRef = d.orderId; return d.queued === true || "foreign receipt was not queued"; } },
    { name: "POST /api/pos/recover (original currency reaches the payment without changing settings)", as: "manager", method: "POST", path: "/api/pos/recover",
      body: f => ({ posRef: f.offlineForeignRef, restaurantId: r, approval: { confirmed: true, reason: "Original foreign-currency receipt checked" } }),
      expect: [200], check: async (d, f) => {
        const [{ data: p }, { data: place }] = await Promise.all([
          f.admin.from("payments").select("amount, currency, actor_email").eq("order_id", d.orderId).single(),
          f.admin.from("restaurants").select("currency").eq("id", r).single(),
        ]);
        return d.settled === true && p?.currency === f.offlineForeignCurrency && Number(p.amount) === f.offlineCharge.total
          && p.actor_email === "demo-cashier@tabletap.dev" && place?.currency === f.restaurant.currency || "foreign money was relabelled";
      } },
    { name: "POST /api/pos/order (offline, a waiter refused)", as: "waiter", method: "POST",
      path: "/api/pos/order",
      body: f => ({ posRef: crypto.randomUUID(), method: "cash", offline: f.offlineCharge,
        items: [{ itemId: f.offlineDish.id, name: "x", price: 1, qty: 1, mods: {} }] }),
      expect: [403] },
  ];
}
