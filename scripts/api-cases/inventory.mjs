import { MARK } from "../api-fixtures.mjs";

export function inventoryCases(fx) {
  const { restaurant } = fx;
  const r = restaurant.id;
  return [
    // ── Stock: a count, a delivery, waste, and the count that compares ────
    { name: "POST /api/costs/ingredients (flour, delivered in three days)", as: "owner", method: "POST",
      path: "/api/costs/ingredients",
      body: { name: `${MARK} flour`, unit: "g", packSize: "1", packUnit: "kg", packPrice: "20", leadDays: "3" },
      expect: [200], save: d => ({ flour: d.id }),
      check: async (d, f) => {
        f.flour = d.id;
        const { data } = await f.admin.from("ingredients").select("lead_days").eq("id", d.id).single();
        return data.lead_days === 3 || `lead_days ${data.lead_days}`;
      } },
    { name: "POST /api/costs/counts (the first count has nothing to compare with)", as: "manager", method: "POST",
      path: "/api/costs/counts", body: (_f, saved) => ({ counts: [{ ingredientId: saved.flour, counted: "5000" }] }),
      expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("ingredient_counts").select("counted, expected, counted_by").eq("ingredient_id", f.flour);
        return d.results?.[0]?.expected === null && data?.length === 1 && Number(data[0].counted) === 5000
          && data[0].expected === null && data[0].counted_by === "demo-manager@tabletap.dev" || `stored ${JSON.stringify(data)}`;
      } },
    { name: "POST /api/costs/purchases (two packs at a new price)", as: "owner", method: "POST",
      path: "/api/costs/purchases", body: (_f, saved) => ({ ingredientId: saved.flour, packs: "2", total: "50" }),
      expect: [200],
      check: async (_d, f) => {
        const [{ data: bought }, { data: flour }, { data: rise }] = await Promise.all([
          f.admin.from("ingredient_purchases").select("quantity, total").eq("ingredient_id", f.flour),
          f.admin.from("ingredients").select("pack_price, unit_cost").eq("id", f.flour).single(),
          f.admin.from("ingredient_prices").select("previous_cost, unit_cost").eq("ingredient_id", f.flour).not("previous_cost", "is", null),
        ]);
        return bought?.length === 1 && Number(bought[0].quantity) === 2000 && Number(bought[0].total) === 50
          && Number(flour.pack_price) === 25 && rise?.length === 1 && Number(rise[0].previous_cost) === 0.02
          && Number(rise[0].unit_cost) === 0.025 || `bought ${JSON.stringify(bought)}, now ${JSON.stringify(flour)}, rise ${JSON.stringify(rise)}`;
      } },
    { name: "POST /api/costs/waste (the kitchen spills half a kilo)", as: "kitchen", method: "POST",
      path: "/api/costs/waste", body: (_f, saved) => ({ ingredientId: saved.flour, quantity: "500", reason: "spoiled" }),
      expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("waste_entries").select("quantity, reason, cost, recorded_by").eq("id", d.id).single();
        if (Object.hasOwn(d, "cost")) return "the kitchen received a private waste cost";
        return Number(data.quantity) === 500 && data.reason === "spoiled" && Number(data.cost) === 12.5
          && data.recorded_by === "demo-kitchen@tabletap.dev" || `stored ${JSON.stringify(data)}`;
      } },
    { name: "POST /api/costs/counts (compared with the count, the delivery and the waste)", as: "owner", method: "POST",
      path: "/api/costs/counts", body: (_f, saved) => ({ counts: [{ ingredientId: saved.flour, counted: "6400" }] }),
      expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("ingredient_counts").select("counted, expected")
          .eq("ingredient_id", f.flour).order("created_at", { ascending: false }).limit(1).single();
        // 5000 counted, 2000 delivered, 500 thrown away: 6500 expected.
        return d.results?.[0]?.expected === 6500 && Number(data.expected) === 6500 && Number(data.counted) === 6400
          || `answered ${JSON.stringify(d.results)}, stored ${JSON.stringify(data)}`;
      } },
    // A product thrown away whose stock is counted leaves the count too, in
    // the same transaction. The case's own product, never one of the demo's.
    { name: "POST /api/costs/waste (two unsold, off a counted stock of three)", as: "cashier", method: "POST",
      path: "/api/costs/waste",
      arrange: async f => { await f.admin.from("menu_items").update({ stock: 3 }).eq("id", f.costItem); },
      body: f => ({ itemId: f.costItem, quantity: "2", reason: "unsold", note: `${MARK} waste` }),
      expect: [200],
      check: async (d, f) => {
        f.wasteId = d.id;
        const { data } = await f.admin.from("menu_items").select("stock").eq("id", f.costItem).single();
        if (Object.hasOwn(d, "cost")) return "the cashier received a private waste cost";
        return data.stock === 1 || `stock is ${data.stock}, not 1`;
      } },
    { name: "POST /api/costs/waste (no reason)", as: "kitchen", method: "POST",
      path: "/api/costs/waste", body: (_f, saved) => ({ ingredientId: saved.flour, quantity: "5" }),
      expect: [400], expectError: /por qué se tiró|why it was thrown away/i },
    { name: "POST /api/costs/waste (an ingredient and a product at once)", as: "kitchen", method: "POST",
      path: "/api/costs/waste", body: (f, saved) => ({ ingredientId: saved.flour, itemId: f.costItem, quantity: "1", reason: "mistake" }),
      expect: [400], expectError: /una cosa que se tiró|one thing that was thrown away/i },
    { name: "POST /api/costs/waste (half a product)", as: "kitchen", method: "POST",
      path: "/api/costs/waste", body: f => ({ itemId: f.costItem, quantity: "1.5", reason: "mistake" }),
      expect: [400], expectError: /productos completos|whole products/i },
    { name: "DELETE /api/costs/waste (a cashier cannot take one back)", as: "cashier", method: "DELETE",
      path: "/api/costs/waste", body: f => ({ id: f.wasteId }), expect: [403] },
    { name: "DELETE /api/costs/waste (a manager takes it back)", as: "manager", method: "DELETE",
      path: "/api/costs/waste", body: f => ({ id: f.wasteId }), expect: [200],
      check: async (_d, f) => {
        const { count } = await f.admin.from("waste_entries").select("id", { count: "exact", head: true }).eq("id", f.wasteId);
        return count === 0 || "the entry is still there";
      } },
    { name: "POST /api/costs/purchases (a cashier refused)", as: "cashier", method: "POST",
      path: "/api/costs/purchases", body: (_f, saved) => ({ ingredientId: saved.flour, packs: "1", total: "20" }), expect: [403] },
    { name: "POST /api/costs/purchases (no packs)", as: "owner", method: "POST",
      path: "/api/costs/purchases", body: (_f, saved) => ({ ingredientId: saved.flour, packs: "0", total: "20" }),
      expect: [400], expectError: /cuántos paquetes|how many packs/i },
    { name: "POST /api/costs/counts (the kitchen refused)", as: "kitchen", method: "POST",
      path: "/api/costs/counts", body: (_f, saved) => ({ counts: [{ ingredientId: saved.flour, counted: "1" }] }), expect: [403] },
    { name: "POST /api/costs/counts (another restaurant's ingredient)", as: "owner", method: "POST",
      path: "/api/costs/counts",
      arrange: async f => {
        const { data: other } = await f.admin.from("restaurants").select("id").neq("id", r).limit(1).maybeSingle();
        const { data } = await f.admin.from("ingredients").insert({
          restaurant_id: other.id, name: `${MARK} neighbour stock`, unit: "g", pack_size: 1000, pack_price: 1, updated_by: MARK,
        }).select("id").single();
        f.foreignStock = data?.id ?? "";
        return () => f.admin.from("ingredients").delete().eq("id", f.foreignStock);
      },
      body: f => ({ counts: [{ ingredientId: f.foreignStock, counted: "1" }] }),
      expect: [404], expectError: /no encontrado|not found/i },
    { name: "PATCH /api/costs/settings (buy for ten days)", as: "manager", method: "PATCH",
      path: "/api/costs/settings", body: { purchaseCoverDays: "10" }, expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("restaurants").select("purchase_cover_days, terminal_fee_pct").eq("id", r).single();
        return data.purchase_cover_days === 10 && Number(data.terminal_fee_pct) === 4.25 || `stored ${JSON.stringify(data)}`;
      } },
    { name: "PATCH /api/costs/settings (buy for no days)", as: "owner", method: "PATCH",
      path: "/api/costs/settings", body: { purchaseCoverDays: "0" }, expect: [400],
      expectError: /para cuántos días|how many days to buy/i },
  ];
}
