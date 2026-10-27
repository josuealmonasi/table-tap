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
// The seeder is split by subject — the visit card has its own file — so every
// scripts/mock-*.mjs counts as the seeder.
const seeder = fs.readdirSync("scripts")
  .filter(f => /^mock-.*\.mjs$/.test(f))
  .map(f => fs.readFileSync(`scripts/${f}`, "utf8"))
  .join("\n");

/** Tables that hold no restaurant data, so the demo has nothing to say about them. */
const NOT_DEMO_DATA = new Set([
  "restaurants", // the seeder creates it directly
  "plan_limits", // the price catalogue, shared by everyone
  "restaurant_subscription_prices", // historical Price-to-tier map, shared by everyone
  "platform_admins", // not a restaurant's data
  "platform_admin_audit", // real platform actions only; never fabricate audit history
  "restaurant_accounting_records", // only real deletions retain books; the demo stays live
  "profiles", // created with the logins
  "rate_limits", // throttling counters
  "menus",
  "categories",
  "menu_items",
  "item_addons", // filled by populateMenu()
  "stock_reservations", // internal checkout recovery records, not a demo feature
  "table_session_members", // server-issued credentials; demo bills must never seed usable phone access
  "diner_checkouts", // genuine Stripe session provenance; demo rows must never authorize money
  "kitchen_tickets", // filled by the trigger on the seeder's orders
  "kitchen_requests", // filled by the trigger on the seeder's service requests
  "account_checkouts", // an online payment in progress; only the pay route opens one
  "restaurant_billing_operations", // an in-flight billing claim; seeding one would block checkout
  "refunds_due", // money taken twice; only the webhook finds one, and a demo with one teaches that it happens
  "refund_failures", // Stripe failing a refund it reported succeeded; only its webhook writes one
  "refund_fee_epochs", // a counter the failure moves on; nothing to show without a failure
  "fee_returns", // our fee given back through Stripe; only a real refund creates one
  "fee_reconcile_queue", // charges a Stripe refund event asks to reconcile
  "refund_due_coverage", // the refunds that paid a duplicate charge back; only a real refund
]);

describe("the demo shows the whole app", () => {
  it("fills the kitchen projections through the seeded source tables", () => {
    for (const [target, source, fn] of [["kitchen_tickets", "orders", "sync_kitchen_ticket"],
      ["kitchen_requests", "service_requests", "sync_kitchen_request"]]) {
      expect(seeder).toMatch(new RegExp(`\\b${source}\\b`));
      expect(schema).toContain(`after insert or update on ${source}`);
      expect(schema).toContain(`execute function public.${fn}()`);
      const body = schema.split(`create or replace function public.${fn}()`)[1]?.split("end; $$;")[0];
      expect(body).toContain(`insert into ${target}`);
    }
  });
  it("only seeds coupon codes the app will accept", () => {
    // The seeder writes coupons with direct SQL, skipping /api/coupons'
    // validation. It seeded VIP-15, BIEN-10 and HOLA-50: the list offered them
    // with a computed discount and applying them said "coupon not found".
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
