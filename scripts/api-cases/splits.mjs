import { MARK } from "../api-fixtures.mjs";

export function splitsCases(fx) {
  const { restaurant, table } = fx;
  const r = restaurant.id;
  return [
    // A receipt follows a paid part even after the bill closes. Its reader
    // requires the same approved phone as the bill, never the sitting id alone.
    { name: "GET  /api/receipt/payments (approved phone)", as: "diner", method: "GET",
      path: f => `/api/receipt/payments?restaurantId=${r}&tableId=${f.splitTableId ?? table.id}&sessionId=${f.splitSessionId ?? ""}`,
      expect: [200], check: d => typeof d.split === "boolean" && Array.isArray(d.payments)
        && d.payments.every(p => typeof p.paymentId === "string" && Array.isArray(p.slots)
          && !Object.keys(p).some(key => /checkout|intent|secret/i.test(key))) || "invalid payment receipt identities" },
    { name: "GET  /api/receipt/payments (no phone cookie)", as: "diner", method: "GET",
      path: f => `/api/receipt/payments?restaurantId=${r}&tableId=${f.splitTableId ?? table.id}&sessionId=${f.splitSessionId ?? ""}`,
      headers: { cookie: "" }, expect: [403] },
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
    // Proposed for real, on a table of its own with two diners' unpaid orders,
    // and judged by the seat: the call that seats the proposer once named the
    // old function's arguments, failed unread, and left them without a share.
    { name: "POST /api/split (the proposer takes a seat)", as: "diner", method: "POST", path: "/api/split",
      arrange: async f => {
        const { data: t } = await f.admin.from("restaurant_tables")
          .insert({ restaurant_id: r, label: `${MARK}-propose` }).select("id, label").single();
        const { data: sit } = await f.admin.from("table_sessions")
          .insert({ restaurant_id: r, table_id: t.id }).select("id").single();
        const order = diner => ({
          restaurant_id: r, table_id: t.id, table_label: t.label, session_id: sit.id, diner,
          items: [{ itemId: f.dish.id, name: f.dish.name, emoji: "🍽️", price: f.lineTotal, qty: 1, mods: {} }],
          subtotal: f.lineTotal, service_fee: 0, tip: 0, tax_pct: 0, discount: 0, total: f.lineTotal,
          note: MARK, status: "received", paid: false,
        });
        const { error } = await f.admin.from("orders").insert([order(`${MARK}-a`), order(`${MARK}-b`)]);
        if (error) throw new Error(`could not seat two diners: ${error.message}`);
        f.propose = { table: t.id, session: sit.id };
        return async () => {
          const { data: splits } = await f.admin.from("bill_splits").select("id").eq("session_id", sit.id);
          const ids = (splits ?? []).map(x => x.id);
          if (ids.length) {
            await f.admin.from("bill_split_claims").delete().in("split_id", ids);
            await f.admin.from("bill_splits").delete().in("id", ids);
          }
          await f.admin.from("orders").delete().eq("session_id", sit.id);
          await f.admin.from("table_sessions").delete().eq("id", sit.id);
          await f.admin.from("restaurant_tables").delete().eq("id", t.id);
        };
      },
      body: f => ({ sessionId: f.propose.session, diner: `${MARK}-a`, restaurantId: r, tableId: f.propose.table, shares: 2 }),
      expect: [200],
      check: async (_d, f) => {
        const { data: split } = await f.admin.from("bill_splits").select("id")
          .eq("session_id", f.propose.session).eq("status", "proposed").maybeSingle();
        if (!split) return "no proposal was recorded";
        const { data: seats } = await f.admin.from("bill_split_claims").select("diner").eq("split_id", split.id);
        return (seats ?? []).some(x => x.diner === f.phoneMembers.idFor(f.propose.session, `${MARK}-a`)) || `the proposer has no seat (${JSON.stringify(seats)})`;
      } },
    // Valid JSON with the wrong types: each of these once answered 500.
    { name: "POST /api/receipt (order ids that are not a list)", as: "diner", method: "POST", path: "/api/receipt",
      body: { orderIds: "x", email: "a@example.com" }, expect: [400, 429] },
    { name: "POST /api/ratings (a rating that is null)", as: "diner", method: "POST", path: "/api/ratings",
      body: { restaurantId: r, ratings: [null] }, expect: [400, 429] },
    { name: "POST /api/signup (a name that is a number)", as: "diner", method: "POST", path: "/api/signup",
      body: { acceptedTerms: true, restaurantName: 7, email: "a@example.com", password: "abcdefgh" }, expect: [400, 429] },
    { name: "POST /api/split/join (no such split)", as: "diner", method: "POST", path: "/api/split/join",
      body: { splitId: "00000000-0000-0000-0000-000000000000", sessionId: fx.sessionId ?? "",
              diner: "apicheck", restaurantId: r, tableId: table.id },
      expect: [409] },
    // These three need a card reader, and saying so is the point.
    //
    // /api/split/pay turns everybody away when the restaurant has none — 65%
    // of the route sits behind that one line — and it says so with a 409. The
    // case that used to live here expected 409 for "no such split" and was
    // being handed "this restaurant cannot take cards" instead: a green tick
    // for a refusal it never reached. `arrange` lends the reader for the
    // request and takes it back afterwards, so the refusals below are the
    // route's own.
    { name: "POST /api/split/pay (no card reader)", as: "diner", method: "POST",
      path: "/api/split/pay",
      body: { splitId: "00000000-0000-0000-0000-000000000000", sessionId: fx.sessionId ?? "",
              diner: "apicheck", restaurantId: r, tableId: table.id },
      expect: [409], expectError: /tarjeta|card payments/i },
    { name: "POST /api/split/pay (no such split)", as: "diner", method: "POST",
      path: "/api/split/pay", arrange: f => f.withCardReader(),
      body: { splitId: "00000000-0000-0000-0000-000000000000", sessionId: fx.sessionId ?? "",
              diner: "apicheck", restaurantId: r, tableId: table.id },
      expect: [409], expectError: /falta gente|agreed to the split/i },
    { name: "POST /api/split/pay (a share that is not yours)", as: "diner", method: "POST",
      path: "/api/split/pay", arrange: f => f.withCardReader(),
      body: async f => ({ splitId: f.lockedSplitId, sessionId: f.splitSessionId,
        diner: "nobody-here", restaurantId: r, tableId: f.splitTableId }),
      // 403: the split is real and locked, and this device has no claim on it.
      expect: [403], expectError: /no tienes una parte|do not have a share/i },
    // A real share of this restaurant's split, paid through ANOTHER
    // restaurant that takes cards: nothing tied the split to the restaurant
    // whose Stripe account took the money, so the share would have been
    // marked paid here with the money there. Refused before any fee is
    // reserved or Stripe is asked.
    { name: "POST /api/split/pay (a share paid through another restaurant)", as: "diner", method: "POST",
      path: "/api/split/pay",
      arrange: async f => {
        const { data: other } = await f.admin.from("restaurants").select("id, stripe_account_id, stripe_charges_enabled")
          .neq("id", r).order("name").limit(1).single();
        const { data: otherTable } = await f.admin.from("restaurant_tables").select("id")
          .eq("restaurant_id", other.id).order("label").limit(1).single();
        f.otherRestaurant = other.id;
        f.otherTable = otherTable.id;
        await f.admin.from("restaurants").update({ stripe_account_id: "acct_api_check", stripe_charges_enabled: true }).eq("id", other.id);
        return async () => {
          await f.admin.from("restaurants").update({
            stripe_account_id: other.stripe_account_id, stripe_charges_enabled: other.stripe_charges_enabled,
          }).eq("id", other.id);
        };
      },
      body: async f => ({ splitId: f.lockedSplitId, sessionId: f.splitSessionId,
        diner: `${MARK}-unpaid`, restaurantId: f.otherRestaurant, tableId: f.otherTable }),
      expect: [403], expectError: /teléfono|phone/i,
      effect: async f => {
        const since = new Date(Date.now() - 120_000).toISOString();
        const { count } = await f.admin.from("platform_fees").select("id", { count: "exact", head: true })
          .eq("restaurant_id", f.otherRestaurant).gte("created_at", since);
        return count === 0 || `${count} fee(s) reserved against the other restaurant`;
      } },
    // A share whose checkout another tab is opening right now: its slice of
    // the fee is reserved and its session not yet noted. A second checkout
    // used to open beside it fee-free, and a diner who paid both paid twice.
    // A share whose checkout is already open is resumed, never opened twice:
    // two payable pages for one share is a diner charged twice. The open
    // attempt is planted as the route records one (before Stripe answers), and
    // the case is judged by effect: still exactly one open attempt for the
    // share. Resuming asks Stripe for that session, which the borrowed reader's
    // account cannot answer here, so the route's own answer is a 502.
    { name: "POST /api/split/pay (a share whose checkout is already open)", as: "diner", method: "POST",
      path: "/api/split/pay",
      arrange: async f => {
        const lend = await f.withCardReader();
        const { data: food } = await f.admin.from("orders").insert({
          restaurant_id: r, table_id: f.splitTableId, session_id: f.splitSessionId, items: [], subtotal: 50,
          service_fee: 0, tip: 0, tax_pct: 0, discount: 0, total: 50, note: MARK, status: "received",
        }).select("id").single();
        f.openShareScope = `split:${f.lockedSplitId}:1`;
        const { data: attempt, error } = await f.admin.from("diner_checkouts").insert({
          restaurant_id: r, stripe_account_id: "acct_api_check", livemode: false, currency: "MXN",
          amount_cents: 5000, metadata: { restaurant_id: r }, order_ids: [food.id], status: "open",
          scope_key: f.openShareScope, idempotency_key: `${MARK}-${f.openShareScope}`,
          stripe_params: { mode: "payment" },
        }).select("id").single();
        if (error) throw new Error(`could not plant the open attempt: ${error.message}`);
        return async () => {
          await f.admin.from("diner_checkouts").delete().eq("restaurant_id", r).eq("scope_key", f.openShareScope);
          if (attempt?.id) await f.admin.from("diner_checkouts").delete().eq("id", attempt.id);
          if (food?.id) await f.admin.from("orders").delete().eq("id", food.id);
          await lend();
        };
      },
      body: async f => ({ splitId: f.lockedSplitId, sessionId: f.splitSessionId,
        diner: `${MARK}-unpaid`, restaurantId: r, tableId: f.splitTableId }),
      expect: [200, 502],
      effect: async f => {
        const { count } = await f.admin.from("diner_checkouts").select("id", { count: "exact", head: true })
          .eq("restaurant_id", r).eq("scope_key", f.openShareScope).eq("status", "open");
        return count === 1 || `${count} open checkouts for one share`;
      } },
    { name: "POST /api/split/pay (a share already paid)", as: "diner", method: "POST",
      path: "/api/split/pay", arrange: f => f.withCardReader(),
      body: async f => ({ splitId: f.lockedSplitId, sessionId: f.splitSessionId,
        diner: `${MARK}-paid`, restaurantId: r, tableId: f.splitTableId }),
      expect: [409], expectError: /ya está pagada|already paid/i },
  ];
}
