// ============================================================================
// The demo's ingredients and recipes.
// Sales, waste and purchases fill ingredient_consumption and ingredient_movements
// through their triggers, just as they do for a restaurant.
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
  await seedStock(pg, rid, ids, products);
}

// The dairy and the market deliver in a day or two; the roaster takes five.
const LEAD_DAYS = { "Coffee beans": 5, "Whole milk": 1, "Oat milk": 1, "Takeaway cup": 3, "Lid": 3 };

/**
 * Two counts of the milk — the second short of what the books expected, so
 * the stock tab has a difference to show — one of the coffee, deliveries
 * since, and a month of waste for every reason, one of it a product with no
 * recipe (its cost unknown).
 */
async function seedStock(pg, rid, ids, products) {
  for (const [name, days] of Object.entries(LEAD_DAYS)) {
    await pg.query(`update ingredients set lead_days = $2 where id = $1`, [ids.get(name), days]);
  }
  const at = days => `now() - interval '${days} days'`;
  const count = async (name, counted, expected, days, who) => {
    const { rows: [row] } = await pg.query(
      `insert into ingredient_counts (restaurant_id, ingredient_id, counted, counted_by)
       values ($1, $2, $3, $4) returning id`, [rid, ids.get(name), counted, who],
    );
    // These are historical demo counts, before serial cutoffs existed. Keep
    // their dates and expected figures; a live insert always gets today's cutoff.
    await pg.query(
      `update ingredient_counts set created_at = ${at(days)}, expected = $2, movement_cutoff = null where id = $1`,
      [row.id, expected],
    );
  };
  await count("Whole milk", 12000, null, 10, "demo-manager@tabletap.dev");
  await count("Whole milk", 6100, 6500, 3, "demo-manager@tabletap.dev");
  await count("Coffee beans", 2400, null, 3, "demo@tabletap.dev");

  const buy = (name, quantity, total, days) => pg.query(
    `insert into ingredient_purchases (restaurant_id, ingredient_id, quantity, total, recorded_by, created_at)
     values ($1, $2, $3, $4, 'demo-manager@tabletap.dev', ${at(days)})`,
    [rid, ids.get(name), quantity, total],
  );
  await buy("Whole milk", 12000, 15.6, 2);
  await buy("Takeaway cup", 100, 12, 4);

  const dish = name => products.find(p => p.name === name)?.id ?? null;
  const { rows: [pie] } = await pg.query(
    `select id from menu_items where restaurant_id = $1 and name = 'Apple Pie' limit 1`, [rid],
  );
  const waste = [
    [ids.get("Whole milk"), null, "Whole milk", 500, "spoiled", 0.65, "demo-kitchen@tabletap.dev", 8],
    [null, dish("Iced Latte"), "Iced Latte", 1, "mistake", 0.77, "demo-cashier@tabletap.dev", 2],
    [null, dish("French Fries"), "French Fries", 2, "unsold", 0.62, "demo-kitchen@tabletap.dev", 1],
    [ids.get("Lemon"), null, "Lemon", 3, "staff", 0.24, "demo-cashier@tabletap.dev", 4],
    [null, pie?.id ?? null, "Apple Pie", 1, "unsold", null, "demo-kitchen@tabletap.dev", 1],
  ];
  for (const [ingredientId, itemId, name, quantity, reason, cost, who, days] of waste) {
    if (!ingredientId && !itemId) continue;
    await pg.query(
      `insert into waste_entries (restaurant_id, ingredient_id, item_id, name, quantity, reason, cost, recorded_by, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, ${at(days)})`,
      [rid, ingredientId, itemId, name, quantity, reason, cost, who],
    );
  }
}
