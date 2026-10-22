import { MARK } from "./api-fixtures.mjs";

export async function checked(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function ask(f, path, body, as = "manager") {
  const response = await fetch(f.base + path, { method: "POST",
    headers: { "Content-Type": "application/json", cookie: as === "diner" ? "" : f.who[as], "x-forwarded-for": "203.0.113.220" },
    body: JSON.stringify(body) });
  const data = await response.json();
  if (response.status !== 200) throw new Error(`${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

/** Every retry case owns its rows and restores the switches it borrows. */
export async function arrangeRetry(f, state, kind) {
  const r = f.restaurant.id;
  state.ref = crypto.randomUUID();
  const old = await checked(f.admin.from("restaurants")
    .select("plan, plan_status, accepting_orders, allow_pay_later, service_enabled, low_stock_alerts_enabled").eq("id", r).single());
  const menu = await checked(f.admin.from("menus").select("active, schedule").eq("id", f.menu.id).single());
  const undo = async () => {
    const orders = await checked(f.admin.from("orders").select("id, stock_reservation_id").eq("restaurant_id", r)
      .or(`request_ref.eq.${state.ref},pos_ref.eq.${state.ref}`));
    const ids = orders.map(o => o.id);
    if (state.coupon) {
      await checked(f.admin.from("coupon_redemptions").delete().eq("coupon_id", state.coupon.id));
      await checked(f.admin.from("coupons").delete().eq("id", state.coupon.id));
    }
    if (ids.length) {
      await checked(f.admin.from("payments").delete().in("order_id", ids));
      await checked(f.admin.from("orders").delete().in("id", ids));
      await checked(f.admin.from("ingredient_consumption").delete().eq("source_kind", "sale").in("source_id", ids));
      const reservations = orders.map(o => o.stock_reservation_id).filter(Boolean);
      if (reservations.length) await checked(f.admin.from("stock_reservations").delete().in("id", reservations));
    }
    if (state.table) {
      await checked(f.admin.from("table_sessions").delete().eq("table_id", state.table));
      await checked(f.admin.from("restaurant_tables").delete().eq("id", state.table));
    }
    if (state.dish) await checked(f.admin.from("menu_items").delete().eq("id", state.dish));
    if (state.account) await checked(f.admin.from("customer_accounts").delete().eq("id", state.account));
    if (state.ingredient) {
      // Movement rows are a separate journal, so removing the source is not enough.
      const sourceIds = [];
      for (const table of ["ingredient_purchases", "waste_entries"]) sourceIds.push(...(await checked(f.admin.from(table).select("id").eq("ingredient_id", state.ingredient))).map(row => row.id));
      await checked(f.admin.from("ingredient_purchases").delete().eq("ingredient_id", state.ingredient));
      await checked(f.admin.from("waste_entries").delete().eq("ingredient_id", state.ingredient));
      await checked(f.admin.from("ingredient_counts").delete().eq("ingredient_id", state.ingredient));
      if (sourceIds.length) await checked(f.admin.from("ingredient_consumption").delete().in("source_id", sourceIds));
      await checked(f.admin.from("ingredient_movements").delete().eq("ingredient_id", state.ingredient));
      await checked(f.admin.from("ingredients").delete().eq("id", state.ingredient));
    }
    if (state.shifts?.length) {
      await checked(f.admin.from("cash_movements").delete().in("shift_id", state.shifts));
      await checked(f.admin.from("cash_shifts").delete().in("id", state.shifts));
    }
    await checked(f.admin.from("menus").update(menu).eq("id", f.menu.id));
    await checked(f.admin.from("restaurants").update(old).eq("id", r));
  };
  try {
    await checked(f.admin.from("restaurants").update({ plan: "casa", plan_status: "active", accepting_orders: true,
      allow_pay_later: true, service_enabled: false, low_stock_alerts_enabled: false }).eq("id", r));
    await checked(f.admin.from("menus").update({ active: true, schedule: null }).eq("id", f.menu.id));
    if (["checkout", "table-order", "pos"].includes(kind)) {
      const dish = await checked(f.admin.from("menu_items").insert({ restaurant_id: r, name: `${MARK} retry ${state.ref}`,
        menu_id: f.menu.id, price: 10, available: true, stock: 10, modifiers: [], discount_pct: 0 }).select("id").single());
      state.dish = dish.id;
      state.items = [{ itemId: dish.id, name: "Retry dish", price: 10, qty: 1, mods: {}, emoji: "" }];
      if (kind === "checkout") {
        state.coupon = await checked(f.admin.from("coupons").insert({ restaurant_id: r,
          // Codes are XXX-XXX (`COUPON_PATTERN`): a longer one is normalised to its
        // first six characters and never found, so checkout said "notFound".
        code: `R${state.ref.replaceAll("-", "").slice(0, 2)}-${state.ref.replaceAll("-", "").slice(2, 5)}`.toUpperCase(), kind: "fixed", value: 1, max_uses: 1 }).select("id, code").single());
      }
      if (kind === "table-order") {
        state.table = (await checked(f.admin.from("restaurant_tables").insert({ restaurant_id: r, label: `${MARK} retry` }).select("id").single())).id;
      }
      if (kind === "pos") {
        state.account = (await checked(f.admin.from("customer_accounts").insert({ restaurant_id: r, name: `${MARK} retry`, code: state.ref.replaceAll("-", "").slice(0, 12).toUpperCase(), credit_limit: 1000, opened_by: MARK }).select("id").single())).id;
      }
    } else if (["purchase", "waste", "count"].includes(kind)) {
      state.ingredient = (await checked(f.admin.from("ingredients").insert({ restaurant_id: r,
        name: `${MARK} retry ${state.ref}`, unit: "g", pack_size: 1000, pack_price: 20, updated_by: MARK }).select("id").single())).id;
    } else {
      // These cases run after the ordinary close chain. Refuse to borrow an open shift.
      const open = await checked(f.admin.from("cash_shifts").select("id").eq("restaurant_id", r).is("closed_at", null).maybeSingle());
      if (open) throw new Error("retry case requires the ordinary shift chain to have closed");
      const shift = await checked(f.admin.from("cash_shifts").insert({ restaurant_id: r, opening_amount: 100, opened_by: MARK }).select("id").single());
      state.shifts = [shift.id];
    }
    return undo;
  } catch (error) { await undo(); throw error; }
}
