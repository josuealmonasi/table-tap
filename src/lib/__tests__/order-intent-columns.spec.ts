import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { checkoutOrderRow } from "@/lib/checkout/order-row";

// A pay-later order is written by create_order_intent in SQL, and a card
// order by the route from the same checkoutOrderRow. Two places must agree:
// a column added to the builder and not to the SQL insert vanishes from
// every pay-later order without an error.
it("every field the checkout writes is in create_order_intent's insert", () => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const start = schema.lastIndexOf("create or replace function public.create_order_intent(");
  const fn = schema.slice(start, schema.indexOf("$$;", schema.indexOf("$$", start) + 2));
  const insert = /insert into orders\(([^)]*)\)/.exec(fn)?.[1] ?? "";
  const columns = new Set(insert.split(",").map(c => c.trim()));
  expect(columns.size).toBeGreaterThan(10);
  const row = checkoutOrderRow({
    restaurantId: "r", table: { id: "t", label: "1" }, sessionId: "s", diner: "d", deferred: true,
    pricing: { subtotal: 10, serviceFee: 0, tip: 0, discount: 0, total: 10, itemDiscount: 0, promoDiscount: 0, couponDiscount: 0 } as never,
    taxPct: 0, couponCode: null, currency: "MXN", verified: [], note: undefined, customerName: undefined,
  });
  const missing = Object.keys(row).filter(key => !columns.has(key));
  expect(missing, "written by the card checkout but dropped by the pay-later insert").toEqual([]);
});

it("judges a coupon's minimum spend on the subtotal before the coupon, as the route does", () => {
  // MX$100 of goods, a MX$10 coupon with a MX$100 minimum: the route accepted
  // it on 100, the SQL refused it on the order's 90 (audit K cross-review, 5).
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const start = schema.lastIndexOf("create or replace function public.create_order_intent(");
  const fn = schema.slice(start, schema.indexOf("$$;", schema.indexOf("$$", start) + 2));
  expect(fn).toMatch(/min_subtotal > coalesce\(\(p_coupon->>'eligible_subtotal'\)::numeric/);
  const route = readFileSync("src/app/api/checkout/route.ts", "utf8");
  expect(route).toContain("eligible_subtotal: base.subtotal");
  expect(route).toContain("claimCheckoutCoupon(restaurantId, couponCode, base.subtotal");
});
