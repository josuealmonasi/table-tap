import { MARK } from "../api-fixtures.mjs";
import { offlineCases } from "../api-offline-cases.mjs";
import { terminalDepositRace } from "../api-terminal-deposit.mjs";

export function posRefusalCases() {
  return [
    { name: "POST /api/pos/upload (new money is refused)", as: "cashier", method: "POST", path: "/api/pos/upload", body: {}, expect: [400] },
    { name: "POST /api/terminal/deposits/verify (missing bank confirmation)", as: "manager", method: "POST", path: "/api/terminal/deposits/verify", body: {}, expect: [400] },
    { name: "POST /api/pos/recover (missing attestation)", as: "owner", method: "POST", path: "/api/pos/recover", body: {}, expect: [400] },
  ];
}

export function posRoleCases() {
  return [
    // ── gerencia ─────────────────────────────────────────────────────────
    // The counter till. A cashier may ring a sale; a waiter may not, and the
    // route says so rather than the screen merely hiding the link.
    { name: "POST /api/pos/order (waiter refused)", as: "waiter", method: "POST",
      path: "/api/pos/order",
      body: { posRef: "00000000-0000-4000-8000-000000000001", method: "cash",
              items: [{ itemId: "00000000-0000-4000-8000-000000000002", qty: 1 }] },
      expect: [403] },
  ];
}

export function posSaleCases(fx) {
  const { restaurant, dish } = fx;
  const r = restaurant.id;
  return [
    // ── Caja: the register on its own ────────────────────────────────────
    // A diner's phone cannot check out — the order is taken at the register —
    // and the route says the same sentence the menu does.
    { name: "POST /api/checkout (Caja takes the order at the register)", as: "diner", method: "POST",
      path: "/api/checkout", arrange: f => f.onCaja(),
      body: { restaurantId: r, tableId: null, payLater: true, note: MARK,
        items: [{ itemId: dish.id, name: dish.name, price: Number(dish.price), qty: 1,
          emoji: "🍽️", mods: {} }] },
      expect: [409], expectError: /toma los pedidos en la caja|takes orders at the register/i },
    // No kitchen board and no tables, so no login for a cook: refused with the
    // tier that has one, before any invite is sent.
    { name: "POST /api/staff (a cook on Caja)", as: "owner", method: "POST", path: "/api/staff",
      arrange: f => f.onCaja(), body: { email: "demo-waiter@tabletap.dev", role: "kitchen" },
      expect: [403], expectError: /cocina y meseros|kitchen and waiter/i },
    // Served where it is paid: with no board to wait on, the sale is finished
    // the moment it is rung.
    { name: "POST /api/pos/order (Caja: served where it is paid)", as: "cashier", method: "POST",
      path: "/api/pos/order", arrange: f => f.onCaja(),
      body: { posRef: crypto.randomUUID(), method: "cash", note: `${MARK} caja`,
        items: [{ itemId: dish.id, name: dish.name, price: Number(dish.price), qty: 1,
          emoji: "🍽️", mods: {} }] },
      expect: [200],
      effect: async f => {
        const { data } = await f.admin.from("orders").select("id, status, paid, total")
          .eq("restaurant_id", f.restaurant.id).eq("note", `${MARK} caja`).maybeSingle();
        if (!(data?.status === "completed" && data?.paid === true)) {
          return `the sale is ${data?.status ?? "missing"}, paid=${data?.paid}`;
        }
        // Rung and recorded as one write: the sale has exactly its money.
        const { data: rows } = await f.admin.from("payments").select("amount, method, actor_email").eq("order_id", data.id);
        if (rows?.length !== 1) return `${rows?.length ?? 0} payment(s) recorded for the sale`;
        return Number(rows[0].amount) === Number(data.total) && rows[0].method === "cash" && rows[0].actor_email
          ? true
          : `recorded ${JSON.stringify(rows[0])} for a MX$${data.total} sale`;
      } },
    // A card on the restaurant's own terminal, with the voucher's
    // authorization number kept on the payment to find the sale later. The
    // sale and its money go again after the case, the payment first.
    { name: "POST /api/pos/order (a card on the terminal, with its voucher)", as: "cashier", method: "POST",
      path: "/api/pos/order",
      arrange: f => async () => {
        const { data: sales } = await f.admin.from("orders").select("id")
          .eq("restaurant_id", f.restaurant.id).eq("note", `${MARK} terminal`);
        const ids = (sales ?? []).map(o => o.id);
        if (ids.length) {
          await f.admin.from("payments").delete().in("order_id", ids);
          await f.admin.from("orders").delete().in("id", ids);
        }
      },
      body: { posRef: crypto.randomUUID(), method: "card", note: `${MARK} terminal`, terminalRef: "  AUTH 482913 ",
        items: [{ itemId: dish.id, name: dish.name, price: Number(dish.price), qty: 1, emoji: "🍽️", mods: {} }] },
      expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("payments").select("method, terminal_ref, stripe_payment_intent").eq("order_id", d.orderId);
        return data?.length === 1 && data[0].method === "card" && data[0].terminal_ref === "AUTH 482913"
          && data[0].stripe_payment_intent === null || `recorded ${JSON.stringify(data)}`;
      } },
    terminalDepositRace(),
    // The terminal's deposits, on a day the demo took cards on its terminal.
    { name: "POST /api/terminal/deposits (a day's deposit arrived short)", as: "manager", method: "POST",
      path: "/api/terminal/deposits",
      // The most recent day the terminal took cards that nobody has marked
      // yet — the seed marks the older ones, as a café that reconciles would.
      arrange: async f => {
        const since = new Date(Date.now() - 10 * 86_400_000).toISOString();
        const day = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: f.restaurant.timezone ?? "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
        const [{ data: paid }, { data: marked }] = await Promise.all([
          f.admin.from("payments").select("created_at").eq("restaurant_id", r).eq("currency", f.restaurant.currency).eq("method", "card")
            .is("stripe_payment_intent", null).gte("created_at", since).order("created_at", { ascending: false }),
          f.admin.from("terminal_deposits").select("sales_day").eq("restaurant_id", r).eq("currency", f.restaurant.currency),
        ]);
        const taken = new Set((marked ?? []).map(d => d.sales_day));
        f.depositDay = (paid ?? []).map(p => day(p.created_at)).find(d => !taken.has(d)) ?? "";
      },
      body: f => ({ day: f.depositDay, currency: f.restaurant.currency, received: "100.00", note: `${MARK} deposit` }),
      expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("terminal_deposits").select("expected, received, recorded_by")
          .eq("restaurant_id", r).eq("sales_day", f.depositDay).eq("currency", f.restaurant.currency).single();
        return Number(data.received) === 100 && Number(data.expected) === Number(d.expected) && Number(d.expected) > 0
          && data.recorded_by === "demo-manager@tabletap.dev" || `stored ${JSON.stringify(data)}, answered ${JSON.stringify(d)}`;
      } },
    { name: "POST /api/terminal/deposits (the same day twice)", as: "owner", method: "POST",
      path: "/api/terminal/deposits", body: f => ({ day: f.depositDay, currency: f.restaurant.currency, received: "1" }),
      expect: [409], expectError: /ya está marcado|already marked/i },
    { name: "POST /api/terminal/deposits (a day with no terminal sales)", as: "owner", method: "POST",
      path: "/api/terminal/deposits", body: f => ({ day: "2001-01-01", currency: f.restaurant.currency, received: "1" }),
      expect: [404], expectError: /no hubo cobros|no card payments/i },
    { name: "POST /api/terminal/deposits (a cashier refused)", as: "cashier", method: "POST",
      path: "/api/terminal/deposits", body: f => ({ day: f.depositDay, currency: f.restaurant.currency, received: "1" }), expect: [403] },
    { name: "DELETE /api/terminal/deposits (taken back)", as: "manager", method: "DELETE",
      path: "/api/terminal/deposits", body: f => ({ day: f.depositDay, currency: f.restaurant.currency }), expect: [200],
      check: async (_d, f) => {
        const { count } = await f.admin.from("terminal_deposits").select("id", { count: "exact", head: true })
          .eq("restaurant_id", r).eq("sales_day", f.depositDay).eq("currency", f.restaurant.currency);
        return count === 0 || "the deposit is still marked";
      } },
    { name: "PATCH /api/terminal/deposits (the bank takes two business days)", as: "owner", method: "PATCH",
      path: "/api/terminal/deposits", body: { settleDays: "2" }, expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("restaurants").select("terminal_settle_days").eq("id", r).single();
        return data.terminal_settle_days === 2 || `stored ${data.terminal_settle_days}`;
      } },
    { name: "PATCH /api/terminal/deposits (eleven days)", as: "manager", method: "PATCH",
      path: "/api/terminal/deposits", body: { settleDays: "11" }, expect: [400],
      expectError: /de 0 a 10|from 0 to 10/i },
    ...offlineCases(fx),
    { name: "POST /api/pos/order (no cart)", as: "cashier", method: "POST",
      path: "/api/pos/order",
      body: { posRef: "00000000-0000-4000-8000-000000000003", method: "cash", items: [] },
      // An empty sale is refused before anything is priced or reserved.
      expect: [400, 403] },
  ];
}
