import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");

describe("a dish, its section, its menu and its extras belong to one restaurant (sweep 2, finding 5)", () => {
  it("enforces every reference in the database, for every writer", () => {
    for (const fk of ["categories_menu_same_restaurant", "menu_items_menu_same_restaurant", "menu_items_category_same_restaurant"]) {
      expect(schema, fk).toMatch(new RegExp(`add constraint ${fk}\\s+foreign key \\(restaurant_id, `));
    }
    expect(schema).toContain("create trigger check_item_addon_restaurant before insert or update on item_addons");
  });

  it("leaves one reference per pair of tables, so the API can still embed them (Train A gate)", () => {
    // Two references from menu_items to categories made `categories(station)`
    // ambiguous, and checkout could not read a single dish.
    for (const old of ["categories_menu_id_fkey", "menu_items_menu_id_fkey", "menu_items_category_id_fkey"]) {
      expect(schema, old).toContain(`drop constraint if exists ${old};`);
    }
    // And the composite ones take over what a delete does.
    expect(schema).toMatch(/categories_menu_same_restaurant\s+foreign key \(restaurant_id, menu_id\) references menus \(restaurant_id, id\) on delete cascade/);
    expect(schema).toMatch(/menu_items_menu_same_restaurant\s+foreign key \(restaurant_id, menu_id\) references menus \(restaurant_id, id\) on delete cascade/);
    expect(schema).toMatch(/menu_items_category_same_restaurant\s+foreign key \(restaurant_id, category_id\) references categories \(restaurant_id, id\)\s+on delete set null \(category_id\)/);
  });
});
