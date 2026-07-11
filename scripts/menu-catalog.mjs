// Randomized demo catalog for DEV seeding. Each test menu gets a random draw
// of dishes across a few sections plus a set of extras, with random "popular"
// flags, a few "unavailable" items, and random product↔extra links — so the
// dashboard and customer menu have realistic, varied data to work with.

/** Dish pool (grouped by section). populateMenu() samples from this. */
const DISHES = [
  // Starters
  {
    c: "Starters",
    name: "Edamame",
    price: 5.0,
    emoji: "🫛",
    desc: "Steamed young soybeans, sea salt",
  },
  {
    c: "Starters",
    name: "Spring Rolls",
    price: 6.5,
    emoji: "🥢",
    desc: "Crispy veg rolls, sweet chili dip",
  },
  {
    c: "Starters",
    name: "Gyoza",
    price: 7.0,
    emoji: "🥟",
    desc: "Pan-fried pork dumplings",
  },
  {
    c: "Starters",
    name: "Bruschetta",
    price: 6.0,
    emoji: "🍅",
    desc: "Toasted sourdough, tomato, basil",
  },
  {
    c: "Starters",
    name: "Garlic Bread",
    price: 4.5,
    emoji: "🧄",
    desc: "Warm, buttery, herby",
  },
  {
    c: "Starters",
    name: "Chicken Wings",
    price: 8.5,
    emoji: "🍗",
    desc: "Six wings, house hot sauce",
  },
  {
    c: "Starters",
    name: "Loaded Nachos",
    price: 8.0,
    emoji: "🧀",
    desc: "Cheese, jalapeños, salsa",
  },
  {
    c: "Starters",
    name: "Calamari",
    price: 9.0,
    emoji: "🦑",
    desc: "Crispy squid, lemon aioli",
  },
  {
    c: "Starters",
    name: "Soup of the Day",
    price: 5.5,
    emoji: "🍲",
    desc: "Ask your server",
  },
  // Mains
  {
    c: "Mains",
    name: "Margherita Pizza",
    price: 11.0,
    emoji: "🍕",
    desc: "Tomato, mozzarella, basil",
  },
  {
    c: "Mains",
    name: "Classic Cheeseburger",
    price: 12.5,
    emoji: "🍔",
    desc: "Beef, cheddar, pickles, fries",
  },
  {
    c: "Mains",
    name: "Tonkotsu Ramen",
    price: 13.0,
    emoji: "🍜",
    desc: "Rich pork broth, egg, chashu",
  },
  {
    c: "Mains",
    name: "Pad Thai",
    price: 11.5,
    emoji: "🍤",
    desc: "Rice noodles, peanuts, lime",
  },
  {
    c: "Mains",
    name: "Grilled Salmon",
    price: 16.0,
    emoji: "🐟",
    desc: "Seasonal greens, lemon butter",
  },
  {
    c: "Mains",
    name: "Ribeye Steak",
    price: 22.0,
    emoji: "🥩",
    desc: "300g, chimichurri, fries",
  },
  {
    c: "Mains",
    name: "Chicken Curry",
    price: 12.0,
    emoji: "🍛",
    desc: "Coconut, jasmine rice",
  },
  {
    c: "Mains",
    name: "Fish & Chips",
    price: 13.5,
    emoji: "🍟",
    desc: "Beer-battered cod, mushy peas",
  },
  {
    c: "Mains",
    name: "Spaghetti Carbonara",
    price: 12.0,
    emoji: "🍝",
    desc: "Pancetta, egg, pecorino",
  },
  {
    c: "Mains",
    name: "Beef Tacos",
    price: 10.5,
    emoji: "🌮",
    desc: "Three, salsa verde, lime",
  },
  {
    c: "Mains",
    name: "Veggie Buddha Bowl",
    price: 11.0,
    emoji: "🥗",
    desc: "Grains, roasted veg, tahini",
  },
  {
    c: "Mains",
    name: "Katsu Curry",
    price: 12.5,
    emoji: "🍱",
    desc: "Panko chicken, curry sauce",
  },
  // Sides
  { c: "Sides", name: "French Fries", price: 4.0, emoji: "🍟", desc: "Crispy, sea salt" },
  { c: "Sides", name: "Onion Rings", price: 4.5, emoji: "🧅", desc: "Beer-battered" },
  {
    c: "Sides",
    name: "Side Salad",
    price: 4.0,
    emoji: "🥗",
    desc: "Mixed leaves, vinaigrette",
  },
  {
    c: "Sides",
    name: "Mashed Potatoes",
    price: 4.5,
    emoji: "🥔",
    desc: "Buttery, creamy",
  },
  { c: "Sides", name: "Steamed Rice", price: 3.0, emoji: "🍚", desc: "Jasmine" },
  { c: "Sides", name: "Coleslaw", price: 3.5, emoji: "🥬", desc: "House-made" },
  // Desserts
  { c: "Desserts", name: "Cheesecake", price: 6.5, emoji: "🍰", desc: "New York style" },
  {
    c: "Desserts",
    name: "Chocolate Lava Cake",
    price: 7.0,
    emoji: "🍫",
    desc: "Molten center, vanilla ice cream",
  },
  {
    c: "Desserts",
    name: "Matcha Tiramisu",
    price: 7.5,
    emoji: "🍵",
    desc: "Green tea twist",
  },
  {
    c: "Desserts",
    name: "Mochi Ice Cream",
    price: 5.5,
    emoji: "🍡",
    desc: "Three pieces",
  },
  { c: "Desserts", name: "Apple Pie", price: 6.0, emoji: "🥧", desc: "Warm, cinnamon" },
  // Drinks
  {
    c: "Drinks",
    name: "Iced Latte",
    price: 4.5,
    emoji: "🧋",
    desc: "Double shot, oat option",
  },
  { c: "Drinks", name: "Green Tea", price: 3.0, emoji: "🍵", desc: "Sencha" },
  { c: "Drinks", name: "Fresh Lemonade", price: 4.0, emoji: "🍋", desc: "House-made" },
  { c: "Drinks", name: "Craft Beer", price: 6.0, emoji: "🍺", desc: "Local IPA" },
  { c: "Drinks", name: "House Red Wine", price: 7.0, emoji: "🍷", desc: "175ml glass" },
  { c: "Drinks", name: "Sparkling Water", price: 2.5, emoji: "💧", desc: "330ml" },
];

/** Extra (add-on) pool. */
const EXTRAS = [
  { name: "Extra Cheese", price: 1.5, emoji: "🧀" },
  { name: "Bacon", price: 2.0, emoji: "🥓" },
  { name: "Avocado", price: 2.0, emoji: "🥑" },
  { name: "Fried Egg", price: 1.5, emoji: "🍳" },
  { name: "Extra Sauce", price: 0.8, emoji: "🥫" },
  { name: "Sautéed Mushrooms", price: 1.8, emoji: "🍄" },
  { name: "Jalapeños", price: 1.0, emoji: "🌶️" },
  { name: "Caramelized Onions", price: 1.2, emoji: "🧅" },
  { name: "Pickles", price: 0.8, emoji: "🥒" },
  { name: "Extra Shot", price: 1.0, emoji: "☕" },
  { name: "Whipped Cream", price: 1.0, emoji: "🍦" },
  { name: "Oat Milk", price: 0.7, emoji: "🥛" },
  { name: "Truffle Oil", price: 2.5, emoji: "🫒" },
  { name: "Kimchi", price: 1.5, emoji: "🥬" },
  { name: "Guacamole", price: 2.2, emoji: "🥑" },
  { name: "Sour Cream", price: 1.0, emoji: "🥛" },
];

const SECTION_ORDER = ["Starters", "Mains", "Sides", "Desserts", "Drinks"];
const PRODUCTS_PER_MENU = 22;
const EXTRAS_PER_MENU = 12;

const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const sample = (arr, n) => shuffle(arr).slice(0, n);

/** insert ... values (…),(…) with positional params; optional RETURNING. */
async function bulkInsert(pg, table, columns, rows, returning = "") {
  if (!rows.length) return [];
  const params = [];
  const tuples = rows.map(
    row =>
      `(${row
        .map(v => {
          params.push(v);
          return `$${params.length}`;
        })
        .join(",")})`,
  );
  const sql = `insert into ${table} (${columns.join(",")}) values ${tuples.join(",")}${returning ? ` returning ${returning}` : ""}`;
  const { rows: out } = await pg.query(sql, params);
  return out;
}

/**
 * Fills one menu with a randomized catalog: ~22 dishes across their sections,
 * ~12 extras, ~30% marked popular, ~12% unavailable, and each dish linked to a
 * random 0–4 of the menu's extras. Idempotent: a menu already holding ≥20
 * products is left untouched, so re-running `db:seed` won't pile up duplicates.
 *
 * @param {import("pg").Client} pg
 * @param {string} restaurantId
 * @param {string} menuId
 */
export async function populateMenu(pg, restaurantId, menuId) {
  const {
    rows: [{ count }],
  } = await pg.query(
    "select count(*)::int as count from menu_items where menu_id = $1 and not is_addon",
    [menuId],
  );
  if (count >= 20) return { skipped: true };

  // Clean slate for this menu (handles a partial earlier seed).
  await pg.query("delete from menu_items where menu_id = $1", [menuId]);
  await pg.query("delete from categories where menu_id = $1", [menuId]);

  const dishes = sample(DISHES, PRODUCTS_PER_MENU);
  const extras = sample(EXTRAS, EXTRAS_PER_MENU);

  // Sections actually used, in a sensible order.
  const usedSections = SECTION_ORDER.filter(s => dishes.some(d => d.c === s));
  const catRows = await bulkInsert(
    pg,
    "categories",
    ["restaurant_id", "menu_id", "name", "sort_order"],
    usedSections.map((name, i) => [restaurantId, menuId, name, i]),
    "id, name",
  );
  const catId = Object.fromEntries(catRows.map(r => [r.name, r.id]));

  // Extras (add-on items).
  const itemCols = [
    "restaurant_id",
    "menu_id",
    "category_id",
    "name",
    "description",
    "price",
    "emoji",
    "popular",
    "available",
    "is_addon",
    "sort_order",
  ];
  const addonRows = await bulkInsert(
    pg,
    "menu_items",
    itemCols,
    extras.map((e, i) => [
      restaurantId,
      menuId,
      null,
      e.name,
      null,
      e.price,
      e.emoji,
      false,
      true,
      true,
      i,
    ]),
    "id",
  );
  const addonIds = addonRows.map(r => r.id);

  // Products (RETURNING order matches VALUES order in a single INSERT).
  const sortByCat = {};
  const productRows = await bulkInsert(
    pg,
    "menu_items",
    itemCols,
    dishes.map(d => {
      const sort = (sortByCat[d.c] = (sortByCat[d.c] ?? 0) + 1);
      const popular = Math.random() < 0.3;
      const available = Math.random() > 0.12;
      return [
        restaurantId,
        menuId,
        catId[d.c],
        d.name,
        d.desc,
        d.price,
        d.emoji,
        popular,
        available,
        false,
        sort,
      ];
    }),
    "id",
  );

  // Link each product to a random 0–4 of the menu's extras.
  const links = [];
  for (const p of productRows) {
    sample(addonIds, randInt(0, 4)).forEach((addonId, i) =>
      links.push([p.id, addonId, i]),
    );
  }
  await bulkInsert(pg, "item_addons", ["product_id", "addon_id", "sort_order"], links);

  return { products: productRows.length, extras: addonIds.length, links: links.length };
}
