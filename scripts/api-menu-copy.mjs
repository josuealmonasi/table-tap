import { isDeepStrictEqual } from "node:util";
import { MARK } from "./api-fixtures.mjs";

const MENU_FIELDS = { active: false, schedule: { enabled: true, rules: [{ days: [1], allDay: true }] } };
const PRODUCT_FIELDS = {
  name: "S14 drink", price: 35, discount_pct: 10, dietary: ["vegan"], skips_kitchen: true,
  description: "Copy all saved settings", emoji: "🥤", image_url: null,
  popular: true, available: true, is_addon: false, sort_order: 3,
  modifiers: [{ label: "Ice", type: "single", options: ["None", "With ice"], required: true }],
};
const EXTRA_FIELDS = {
  ...PRODUCT_FIELDS, name: "S14 extra", is_addon: true, price: 5, discount_pct: 0,
  available: false, sort_order: 7,
};

// Compare values, not JSON text: jsonb hands keys back in its own order
// (shorter first), so the text of a schedule the copy kept intact never matched.
function matches(actual, expected) {
  return Object.entries(expected).every(([key, value]) => isDeepStrictEqual(actual?.[key], value));
}

/** A hidden source keeps the case's copies out of customers' menus. */
export async function arrangeMenuCopy(f) {
  const restaurantId = f.restaurant.id;
  const name = `${MARK} S14 ${crypto.randomUUID()}`;
  const { data: before, error: readError } = await f.admin.from("restaurants")
    .select("plan, plan_status").eq("id", restaurantId).single();
  if (readError) throw readError;
  const restore = async () => {
    try {
      // Names catch even a committed copy whose response never reached the test.
      const { error } = await f.admin.from("menus").delete().eq("restaurant_id", restaurantId).like("name", `${name}%`);
      if (error) throw error;
    } finally {
      const { error } = await f.admin.from("restaurants").update(before).eq("id", restaurantId);
      if (error) throw error;
    }
  };
  try {
    // Both the source and copy need room. Restore the restaurant's tier after.
    const { error: planError } = await f.admin.from("restaurants")
      .update({ plan: "grupo", plan_status: "active" }).eq("id", restaurantId);
    if (planError) throw planError;
    const { data: menu, error: menuError } = await f.admin.from("menus")
      .insert({ restaurant_id: restaurantId, name, ...MENU_FIELDS }).select("id").single();
    if (menuError) throw menuError;
    f.s14MenuSource = menu.id;
    const { data: category, error: categoryError } = await f.admin.from("categories")
      .insert({ restaurant_id: restaurantId, menu_id: menu.id, name: "S14 bar", station: "bar", sort_order: 4 })
      .select("id").single();
    if (categoryError) throw categoryError;
    const { data: items, error: itemError } = await f.admin.from("menu_items").insert([
      { restaurant_id: restaurantId, menu_id: menu.id, category_id: category.id, ...PRODUCT_FIELDS, stock: 7 },
      { restaurant_id: restaurantId, menu_id: menu.id, category_id: null, ...EXTRA_FIELDS, stock: 2 },
    ]).select("id, is_addon");
    if (itemError) throw itemError;
    f.s14SourceItems = items.map(i => i.id);
    const { error: linkError } = await f.admin.from("item_addons").insert({
      product_id: items.find(i => !i.is_addon).id, addon_id: items.find(i => i.is_addon).id, sort_order: 6,
    });
    if (linkError) throw linkError;
    return restore;
  } catch (error) {
    await restore();
    throw error;
  }
}

export async function checkMenuCopy(d, f) {
  if (!d.newMenuId || !d.copyName) return "the copy has no id or name";
  const { data: menu, error: menuError } = await f.admin.from("menus").select("*").eq("id", d.newMenuId).single();
  if (menuError) throw menuError;
  if (!matches(menu, MENU_FIELDS)) return "the menu lost its switch or schedule";
  const { data: categories, error: categoryError } = await f.admin.from("categories").select("*").eq("menu_id", d.newMenuId);
  if (categoryError) throw categoryError;
  if (categories.length !== 1 || !matches(categories[0], { name: "S14 bar", station: "bar", sort_order: 4 })) return "the section lost its preparation station";
  const { data: items, error: itemError } = await f.admin.from("menu_items").select("*").eq("menu_id", d.newMenuId);
  if (itemError) throw itemError;
  if (items.length !== 2 || items.some(i => f.s14SourceItems.includes(i.id))) return "the items were not copied separately";
  const product = items.find(i => !i.is_addon);
  const addon = items.find(i => i.is_addon);
  if (!matches(product, { ...PRODUCT_FIELDS, category_id: categories[0].id, stock: null, stock_auto_off: false })) return "the product lost settings or copied physical stock";
  if (!matches(addon, { ...EXTRA_FIELDS, category_id: null, stock: null, stock_auto_off: false })) return "the extra lost settings or copied physical stock";
  const { data: links, error: linkError } = await f.admin.from("item_addons").select("*").eq("product_id", product.id);
  if (linkError) throw linkError;
  return links.length === 1 && matches(links[0], { addon_id: addon.id, sort_order: 6 }) || "the add-on link was not remapped";
}
