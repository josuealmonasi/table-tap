import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");

describe("a dish, its section, its menu and its extras belong to one restaurant (sweep 2, finding 5)", () => {
  it("enforces every reference in the database, for every writer", () => {
    for (const fk of ["categories_menu_same_restaurant", "menu_items_menu_same_restaurant", "menu_items_category_same_restaurant"]) {
      expect(schema, fk).toMatch(new RegExp(`add constraint ${fk}\\s+foreign key \\(restaurant_id, `));
    }
    expect(schema).toContain("create trigger check_item_addon_restaurant before insert or update on item_addons");
    // The old single-column references still own delete behaviour.
    expect(schema).toContain("category_id   uuid references categories(id) on delete set null");
  });
});
