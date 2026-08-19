import { describe, expect, it } from "vitest";
import fs from "node:fs";

/**
 * The demo has to show the whole app.
 *
 * Every time a feature shipped, the demo seeder stayed where it was — so
 * "Demo Bistro" had no sittings, no cancelled debts, no promotions, no
 * coupons, no ratings and nothing waiting on a manager, while the app had all
 * of it. A demo that only shows the parts written first is worse than none:
 * it teaches whoever is watching that those screens are empty.
 *
 * This fails when a restaurant-scoped table exists that the seeder never
 * writes to, which is the reminder to extend it.
 */
const schema = fs.readFileSync("supabase/schema.sql", "utf8");
const seeder = fs.readFileSync("scripts/mock-data.mjs", "utf8");

/** Tables that hold no restaurant data, so the demo has nothing to say about them. */
const NOT_DEMO_DATA = new Set([
  "restaurants", // the seeder creates it directly
  "plan_limits", // the price catalogue, shared by everyone
  "platform_admins", // not a restaurant's data
  "profiles", // created with the logins
  "rate_limits", // throttling counters
  "menus",
  "categories",
  "menu_items",
  "item_addons", // filled by populateMenu()
]);

describe("the demo shows the whole app", () => {
  it("only seeds coupon codes the app will accept", () => {
    // El seeder escribe cupones con SQL directo, saltándose la validación de
    // /api/coupons. Sembró VIP-15, BIEN-10 y HOLA-50: la lista los ofrecía con
    // su descuento calculado y aplicarlos respondía "no encontramos ese cupón".
    const codes = [...seeder.matchAll(/\$1,'([A-Z0-9-]{5,})','(?:percent|fixed)'/g)].map(m => m[1]);
    expect(codes.length).toBeGreaterThan(0);
    const bad = codes.filter(c => !/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(c));
    expect(bad, `códigos que la app rechaza: ${bad.join(", ")}`).toEqual([]);
  });

  it("writes to every table a restaurant's data lives in", () => {
    const tables = [...new Set(
      [...schema.matchAll(/create table if not exists ([a-z_]+)/g)].map(m => m[1]),
    )].filter(t => !NOT_DEMO_DATA.has(t));

    expect(tables.length).toBeGreaterThan(5);

    const missing = tables.filter(t => !new RegExp(`\\b${t}\\b`).test(seeder));
    expect(
      missing,
      `the demo seeder never fills: ${missing.join(", ")} — add them to scripts/mock-data.mjs`,
    ).toEqual([]);
  });
});
