// ============================================================================
// The demo's ingredients and recipes.
//
// Enough for the costs screen to have something true to say: a café's drinks
// and a burger with their recipes, extras with theirs, a supplier's rise on the
// milk (so "prices that went up" has a product to name), and most of the menu
// left without a recipe — which is how a restaurant starts, and what the
// "sales with no recipe" warning is for. Prices are in the demo menu's scale.
// ============================================================================

const SUPPLIER = { coffee: "South Roasters", dairy: "Valley Dairy", pack: "Pack Supply", market: "Central Market" };

// name, unit, pack size (in g/ml/pza), pack price, supplier
const INGREDIENTS = [
  ["Coffee beans", "g", 1000, 18, SUPPLIER.coffee],
  ["Whole milk", "ml", 1000, 1.1, SUPPLIER.dairy],
  ["Oat milk", "ml", 1000, 2.8, SUPPLIER.dairy],
  ["Takeaway cup", "pza", 50, 6, SUPPLIER.pack],
  ["Lid", "pza", 50, 2.5, SUPPLIER.pack],
  ["Ice", "g", 5000, 1.5, SUPPLIER.market],
  ["Green tea leaves", "g", 100, 4, SUPPLIER.market],
  ["Lemon", "pza", 20, 1.6, SUPPLIER.market],
  ["Sugar", "g", 1000, 1.2, SUPPLIER.market],
  ["Burger bun", "pza", 8, 3.2, SUPPLIER.market],
  ["Ground beef", "g", 1000, 9, SUPPLIER.market],
  ["Cheddar", "g", 500, 4.5, SUPPLIER.dairy],
  ["Potato", "g", 1000, 1.4, SUPPLIER.market],
];

// product name → [ingredient, quantity]
const RECIPES = {
  "Iced Latte": [["Coffee beans", 18], ["Whole milk", 180], ["Ice", 150], ["Takeaway cup", 1], ["Lid", 1]],
  "Green Tea": [["Green tea leaves", 3], ["Takeaway cup", 1]],
  "Fresh Lemonade": [["Lemon", 2], ["Sugar", 25], ["Ice", 150], ["Takeaway cup", 1], ["Lid", 1]],
  "Classic Cheeseburger": [["Burger bun", 1], ["Ground beef", 150], ["Cheddar", 30]],
  "French Fries": [["Potato", 220]],
  // Extras are products too, with recipes of their own.
  "Oat Milk": [["Oat milk", 60]],
  "Extra Shot": [["Coffee beans", 9]],
  "Extra Cheese": [["Cheddar", 20]],
};

export async function seedCosts(pg, rid) {
  const ids = new Map();
  for (const [name, unit, size, price, supplier] of INGREDIENTS) {
    const { rows: [row] } = await pg.query(
      `insert into ingredients (restaurant_id, name, unit, pack_size, pack_price, supplier, updated_by, created_at)
       values ($1, $2, $3, $4, $5, $6, 'demo@tabletap.dev', now() - interval '20 days') returning id`,
      [rid, name, unit, size, price, supplier],
    );
    ids.set(name, row.id);
  }
  // The price each was created with is history from twenty days ago; then the
  // dairy raised the milk last week.
  await pg.query(
    `update ingredient_prices set created_at = now() - interval '20 days' where restaurant_id = $1`, [rid],
  );
  await pg.query(
    `update ingredients set pack_price = 1.3, updated_by = 'demo-manager@tabletap.dev' where id = $1`,
    [ids.get("Whole milk")],
  );
  await pg.query(
    `update ingredient_prices set created_at = now() - interval '6 days'
      where ingredient_id = $1 and previous_cost is not null`,
    [ids.get("Whole milk")],
  );

  const { rows: products } = await pg.query(
    `select id, name from menu_items where restaurant_id = $1 and name = any($2)`,
    [rid, Object.keys(RECIPES)],
  );
  const lines = products.flatMap(p => RECIPES[p.name].map(([ingredient, quantity]) => [p.id, ids.get(ingredient), quantity]));
  for (const [itemId, ingredientId, quantity] of lines) {
    await pg.query(
      `insert into recipe_lines (restaurant_id, item_id, ingredient_id, quantity) values ($1, $2, $3, $4)`,
      [rid, itemId, ingredientId, quantity],
    );
  }
}
