import { MARK } from "../api-fixtures.mjs";

export function ingredientsCases(fx) {
  const { restaurant } = fx;
  const r = restaurant.id;
  return [
    // ── Costs: ingredients, a recipe, the terminal's rate ─────────────────
    // Everything named after the run, so teardown finds it; the rate is put
    // back to what the demo had.
    { name: "POST /api/costs/ingredients (the owner adds one, by the litre)", as: "owner", method: "POST",
      path: "/api/costs/ingredients",
      body: { name: `${MARK} milk`, unit: "ml", packSize: "1", packUnit: "l", packPrice: "30", supplier: "Dairy" },
      expect: [200], save: d => ({ ingredient: d.id }),
      check: async (d, f) => {
        f.costIngredient = d.id;
        const { data } = await f.admin.from("ingredients")
          .select("restaurant_id, unit, pack_size, pack_price, unit_cost, supplier").eq("id", d.id).maybeSingle();
        return data?.restaurant_id === r && data.unit === "ml" && Number(data.pack_size) === 1000
          && Number(data.unit_cost) === 0.03 && data.supplier === "Dairy" || `stored ${JSON.stringify(data)}`;
      } },
    { name: "POST /api/costs/ingredients (the same name twice)", as: "manager", method: "POST",
      path: "/api/costs/ingredients",
      body: { name: `${MARK} MILK`, unit: "ml", packSize: "1", packUnit: "l", packPrice: "30" },
      expect: [409], expectError: /ya hay un ingrediente|already an ingredient/i },
    { name: "POST /api/costs/ingredients (a kilo of something measured in ml)", as: "owner", method: "POST",
      path: "/api/costs/ingredients",
      body: { name: `${MARK} other`, unit: "ml", packSize: "1", packUnit: "kg", packPrice: "30" },
      expect: [400], expectError: /cuánto trae un paquete|how much a pack holds/i },
    { name: "POST /api/costs/ingredients (a cashier refused)", as: "cashier", method: "POST",
      path: "/api/costs/ingredients", body: { name: `${MARK} x`, unit: "g", packSize: "1", packUnit: "kg", packPrice: "1" },
      expect: [403] },
    { name: "PATCH /api/costs/ingredients (the manager records a rise)", as: "manager", method: "PATCH",
      path: "/api/costs/ingredients",
      body: (_f, saved) => ({ id: saved.ingredient, name: `${MARK} milk`, packSize: "1", packUnit: "l", packPrice: "36" }),
      expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("ingredient_prices")
          .select("previous_cost, unit_cost, changed_by").eq("ingredient_id", f.costIngredient).not("previous_cost", "is", null);
        const rise = data?.[0];
        return data?.length === 1 && Number(rise.previous_cost) === 0.03 && Number(rise.unit_cost) === 0.036
          && rise.changed_by === "demo-manager@tabletap.dev" || `history ${JSON.stringify(data)}`;
      } },
    { name: "PUT  /api/costs/recipe (a line on a choice the product offers)", as: "owner", method: "PUT",
      path: "/api/costs/recipe",
      arrange: async f => {
        const { data } = await f.admin.from("menu_items").insert({
          restaurant_id: r, name: `${MARK} costs latte`, price: 50, available: false,
          modifiers: [{ label: "Milk", type: "single", options: ["Whole", "Oat"] }],
        }).select("id").single();
        f.costItem = data?.id ?? "";
      },
      body: (f, saved) => ({ itemId: f.costItem, lines: [{ ingredientId: saved.ingredient, quantity: "200", modLabel: "Milk", modOption: "Whole" }] }),
      expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("recipe_lines")
          .select("restaurant_id, quantity, mod_label, mod_option").eq("item_id", f.costItem);
        return d.lines === 1 && data?.length === 1 && data[0].restaurant_id === r && Number(data[0].quantity) === 200
          && data[0].mod_option === "Whole" || `stored ${JSON.stringify(data)}`;
      } },
    { name: "PUT  /api/costs/recipe (a choice the product does not offer)", as: "owner", method: "PUT",
      path: "/api/costs/recipe",
      body: (f, saved) => ({ itemId: f.costItem, lines: [{ ingredientId: saved.ingredient, quantity: "200", modLabel: "Milk", modOption: "Soy" }] }),
      expect: [400], expectError: /no es una que ofrezca|not one this product offers/i },
    // Another restaurant's ingredient in this one's recipe: refused whole, and
    // the recipe that was there is still there.
    { name: "PUT  /api/costs/recipe (another restaurant's ingredient)", as: "manager", method: "PUT",
      path: "/api/costs/recipe",
      arrange: async f => {
        const { data: other } = await f.admin.from("restaurants").select("id").neq("id", r).limit(1).maybeSingle();
        const { data } = await f.admin.from("ingredients").insert({
          restaurant_id: other.id, name: `${MARK} neighbour`, unit: "g", pack_size: 1000, pack_price: 1, updated_by: MARK,
        }).select("id").single();
        f.foreignIngredient = data?.id ?? "";
        return () => f.admin.from("ingredients").delete().eq("id", f.foreignIngredient);
      },
      body: f => ({ itemId: f.costItem, lines: [{ ingredientId: f.foreignIngredient, quantity: "5" }] }),
      // Refused whole: the archive case below finds the one line still there.
      expect: [409], expectError: /se quitó|was removed/i },
    { name: "PUT  /api/costs/recipe (another restaurant's product)", as: "owner", method: "PUT",
      path: "/api/costs/recipe",
      arrange: async f => {
        const { data } = await f.admin.from("menu_items").select("id").neq("restaurant_id", r).limit(1).maybeSingle();
        f.foreignItem = data?.id ?? "";
      },
      body: (f, saved) => ({ itemId: f.foreignItem, lines: [{ ingredientId: saved.ingredient, quantity: "5" }] }),
      expect: [404], expectError: /no encontrado|not found/i },
    { name: "PUT  /api/costs/recipe (the kitchen refused)", as: "kitchen", method: "PUT",
      path: "/api/costs/recipe", body: f => ({ itemId: f.costItem, lines: [] }), expect: [403] },
    { name: "PATCH /api/costs/settings (the terminal's rate)", as: "manager", method: "PATCH",
      path: "/api/costs/settings", body: { terminalFeePct: "4.25" }, expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("restaurants").select("terminal_fee_pct").eq("id", r).single();
        return Number(data.terminal_fee_pct) === 4.25 || `stored ${data.terminal_fee_pct}`;
      } },
    { name: "PATCH /api/costs/settings (a rate no terminal charges)", as: "owner", method: "PATCH",
      path: "/api/costs/settings", body: { terminalFeePct: "20" }, expect: [400],
      expectError: /de 0 a 15|from 0 to 15/i },
    { name: "DELETE /api/costs/ingredients (archived, and out of every recipe)", as: "owner", method: "DELETE",
      path: "/api/costs/ingredients", body: (_f, saved) => ({ id: saved.ingredient }), expect: [200],
      check: async (d, f) => {
        const [{ data: row }, { count }] = await Promise.all([
          f.admin.from("ingredients").select("archived_at").eq("id", f.costIngredient).single(),
          f.admin.from("recipe_lines").select("id", { count: "exact", head: true }).eq("ingredient_id", f.costIngredient),
        ]);
        return row.archived_at !== null && count === 0 && d.recipeLinesRemoved === 1
          || `archived ${row.archived_at}, ${count} line(s) left, ${d.recipeLinesRemoved} reported`;
      } },
    { name: "DELETE /api/costs/ingredients (one already archived)", as: "manager", method: "DELETE",
      path: "/api/costs/ingredients", body: (_f, saved) => ({ id: saved.ingredient }), expect: [404] },
  ];
}
