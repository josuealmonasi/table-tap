import { arrangeRetry, ask, checked } from "./api-retry-fixture.mjs";

export function retryCases(fx) {
  const r = fx.restaurant.id;
  const orders = ["pos", "checkout", "table-order"].map(kind => {
    const state = {};
    const path = kind === "pos" ? "/api/pos/order" : `/api/${kind}`;
    const body = () => kind === "pos"
      ? { posRef: state.ref, method: "account", accountId: state.account, items: state.items, noReceipt: true }
      : { ref: state.ref, restaurantId: r, tableId: state.table ?? null, payLater: true, items: state.items, couponCode: state.coupon?.code };
    return { name: `S20 K${kind === "pos" ? 3 : 4}: ${path} one intent, one ticket`, as: kind === "checkout" ? "diner" : "manager",
      method: "POST", path, expect: [200], headers: { "x-forwarded-for": "203.0.113.220" },
      arrange: f => arrangeRetry(f, state, kind), body,
      check: async (first, f) => {
        const second = await ask(f, path, body(), kind === "checkout" ? "diner" : "manager");
        const rows = await checked(f.admin.from("orders").select("id, total, account_id, paid")
          .eq("restaurant_id", r).eq(kind === "pos" ? "pos_ref" : "request_ref", state.ref));
        const dish = await checked(f.admin.from("menu_items").select("stock").eq("id", state.dish).single());
        const payments = rows.length ? await checked(f.admin.from("payments").select("amount").in("order_id", rows.map(o => o.id))) : [];
        const debt = kind === "pos" ? await checked(f.admin.from("orders").select("total")
          .eq("account_id", state.account).eq("paid", false)) : rows;
        const total = debt.reduce((n, row) => n + Number(row.total), 0);
        if (kind === "checkout") {
          const coupon = await checked(f.admin.from("coupons").select("uses_count").eq("id", state.coupon.id).single());
          const uses = await checked(f.admin.from("coupon_redemptions").select("amount, confirmed_at").eq("coupon_id", state.coupon.id));
          if (coupon.uses_count !== 1 || uses.length !== 1 || Number(uses[0].amount) !== 1 || !uses[0].confirmed_at) return `coupon spent ${JSON.stringify(coupon)} ${JSON.stringify(uses)}`;
        }
        return first.orderId === second.orderId && rows.length === 1 && dish.stock === 9 && payments.length === 0
          && total === Number(rows[0].total) && total > 0 || `tickets ${JSON.stringify(rows)}, stock ${dish.stock}, debt ${total}, payments ${JSON.stringify(payments)}`;
      } };
  });
  const ingredients = ["purchase", "waste", "count"].map(kind => {
    const state = {};
    const path = `/api/costs/${kind === "purchase" ? "purchases" : kind === "count" ? "counts" : "waste"}`;
    const body = () => kind === "purchase" ? { ref: state.ref, ingredientId: state.ingredient, packs: 2, total: 50 }
      : kind === "waste" ? { ref: state.ref, ingredientId: state.ingredient, quantity: 20, reason: "spoiled" }
      : { ref: state.ref, counts: [{ ingredientId: state.ingredient, counted: 1000 }] };
    return { name: `S20 K6: ${path} retry keeps the first movement`, as: "manager", method: "POST", path, expect: [200],
      arrange: async f => {
        const undo = await arrangeRetry(f, state, kind);
        try {
          if (kind === "count") await checked(f.admin.rpc("record_ingredient_counts", {
            p_restaurant: r, p_actor: "apicheck", p_counts: [{ ingredient_id: state.ingredient, counted: 1000 }],
          }));
          return undo;
        } catch (error) { await undo(); throw error; }
      }, body,
      check: async (first, f) => {
        if (kind !== "waste") await ask(f, "/api/costs/purchases", { ref: crypto.randomUUID(), ingredientId: state.ingredient, packs: 1, total: 30 });
        const second = await ask(f, path, body());
        const table = kind === "purchase" ? "ingredient_purchases" : kind === "count" ? "ingredient_counts" : "waste_entries";
        const rows = await checked(f.admin.from(table).select("*").eq("restaurant_id", r).eq("request_ref", state.ref));
        const moves = await checked(f.admin.from("ingredient_movements").select("id, quantity").eq("ingredient_id", state.ingredient));
        if (kind === "count") {
          const after = moves.filter(m => Number(m.id) > Number(rows[0]?.movement_cutoff)).reduce((n, m) => n + Number(m.quantity), 0);
          return JSON.stringify(first.results) === JSON.stringify(second.results) && rows.length === 1
            && Number(rows[0].expected) === 1000 && after === 1000 || `count moved: ${JSON.stringify(rows)}; after cutoff ${after}`;
        }
        const quantity = moves.reduce((n, m) => n + Number(m.quantity), 0);
        const ingredient = await checked(f.admin.from("ingredients").select("pack_price").eq("id", state.ingredient).single());
        return first.id === second.id && rows.length === 1 && quantity === (kind === "waste" ? -20 : 3000)
          && (kind === "waste" ? Number(rows[0].cost) === 0.4 : Number(rows[0].total) === 50 && Number(ingredient.pack_price) === 30)
          || `rows ${JSON.stringify(rows)}, movement ${quantity}, price ${ingredient.pack_price}`;
      } };
  });
  const drawers = ["withdrawal", "close"].map(kind => {
    const state = {};
    const path = kind === "close" ? "/api/cash-shift" : "/api/cash-drawer";
    const body = () => kind === "close" ? { action: "close", shiftId: state.shifts[0], ref: state.ref, counted: 100, confirm: true }
      : { kind: "withdrawal", shiftId: state.shifts[0], ref: state.ref, amount: 20 };
    return { name: `S20 K${kind === "close" ? 9 : 5}: ${path} retry leaves a newer shift alone`, as: "manager", method: "POST", path, expect: [200],
      arrange: f => arrangeRetry(f, state, kind), body,
      check: async (first, f) => {
        if (kind === "withdrawal") await checked(f.admin.rpc("close_cash_shift", {
          p_restaurant: r, p_shift: state.shifts[0], p_counted: 80, p_actor: "apicheck",
        }));
        const next = await checked(f.admin.from("cash_shifts").insert({ restaurant_id: r, opening_amount: 25, opened_by: "apicheck" }).select("id").single());
        state.shifts.push(next.id);
        const second = await ask(f, path, body());
        const open = await checked(f.admin.from("cash_shifts").select("id").eq("restaurant_id", r).is("closed_at", null).single());
        const movements = await checked(f.admin.from("cash_movements").select("amount, shift_id").in("shift_id", state.shifts));
        if (kind === "withdrawal") return first.id === second.id && open.id === next.id && movements.length === 1
          && Number(movements[0].amount) === 20 && movements[0].shift_id === state.shifts[0] || `movements ${JSON.stringify(movements)}`;
        const stale = await fetch(f.base + path, { method: "POST", headers: { "Content-Type": "application/json", cookie: f.who.manager },
          body: JSON.stringify({ ...body(), ref: crypto.randomUUID() }) });
        const message = await stale.json();
        const stillOpen = await checked(f.admin.from("cash_shifts").select("closed_at").eq("id", next.id).single());
        return first.id === second.id && first.expected === second.expected && first.difference === second.difference
          && open.id === next.id && stillOpen.closed_at === null && movements.length === 0 && stale.status === 409
          && /turno cambió|shift has changed/i.test(message.error) || `close ${JSON.stringify(second)}, stale ${stale.status} ${message.error}`;
      } };
  });
  return [...orders, ...ingredients, ...drawers];
}
