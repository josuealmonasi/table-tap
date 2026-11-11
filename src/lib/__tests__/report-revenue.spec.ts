import { expect, it } from "vitest";
import { computeAnalytics } from "@/lib/analytics";
import { periodContribution } from "@/lib/costs/margins";
import { foodRevenue, lineRevenues, returnedFoodCents } from "@/lib/report-revenue";
import type { ReturnAdjustment } from "@/lib/return-components";
import type { ReturnEvent } from "@/lib/refunds/events";
import { checkoutOrderRow } from "@/lib/checkout/order-row";
import { priceCart } from "@/lib/pricing";

const dish = { itemId: "dish", name: "Dish", emoji: "🍜", price: 100, qty: 1, mods: {} };
const sale = {
  ingredient_costs: [40], items: [dish], subtotal: 100, total: 80, service_fee: 0, tip: 0, tax_pct: 0,
  created_at: "2026-10-21T12:00:00Z",
};

it("I11/J11: a later MX$20 table discount leaves MX$80 product revenue and MX$40 contribution", () => {
  const analytics = computeAnalytics([sale], "today", "UTC");
  const period = periodContribution([sale], 0);
  expect(analytics.revenue).toBe(80);
  expect(analytics.topProducts[0].revenue).toBe(80);
  expect(period.revenue).toBe(80);
  expect(period.contribution).toBe(40);
});

it("shares final food revenue once, keeping service, tips and inclusive IVA separate", () => {
  // MX$100 food was discounted at checkout to MX$80, then by another MX$20.
  const order = { ...sale, subtotal: 80, total: 90, service_fee: 10, tip: 20, tax_pct: 20 };
  const analytics = computeAnalytics([order], "today", "UTC");
  const period = periodContribution([order], 0.1);
  expect(analytics.topProducts[0].revenue).toBe(60);
  expect(period.revenue).toBe(50);
  expect(period.fees).toBe(6);
  expect(period.contribution).toBe(4);
});

it("preserves item, coupon, combo and extra discounts without taking them twice", () => {
  const items = [
    { ...dish, discountPct: 20, extras: [{ id: "extra", name: "Extra", emoji: "", price: 20 }] },
    { ...dish, itemId: "combo", comboId: "combo", price: 50, discountPct: 50 },
  ];
  const pricing = priceCart({ items, servicePct: 10, serviceEnabled: true, tipPct: 20,
    coupon: { code: "SAVE", kind: "fixed", value: 30 } });
  const order = { ...sale, items, total: pricing.total, subtotal: pricing.subtotal, service_fee: pricing.serviceFee, tip: pricing.tip };
  expect(foodRevenue(order)).toBe(120);
  expect(lineRevenues(order)).toEqual([80, 40]);
  expect(computeAnalytics([order], "today", "UTC").topProducts.map(p => p.revenue)).toEqual([80, 40]);
  const period = periodContribution([order], 0);
  expect(period.rows.map(r => r.revenue).sort((a, b) => b - a)).toEqual([80, 40]);
});

it("allocates a cent once across three products", () => {
  const order = { ...sale, total: 0.01, items: [dish, { ...dish, itemId: "two" }, { ...dish, itemId: "three" }] };
  expect(lineRevenues(order)).toEqual([0.01, 0, 0]);
  expect(computeAnalytics([order], "today", "UTC").topProducts.reduce((s, p) => s + p.revenue, 0)).toBe(0.01);
  const period = periodContribution([order], 0);
  expect(period.revenue + period.uncosted).toBe(0.01);
});

it("keeps a fully discounted sale's ingredient cost without negative food revenue", () => {
  const order = { ...sale, total: 10, service_fee: 10, tip: 10 };
  const period = periodContribution([order], 0);
  expect(foodRevenue(order)).toBe(0);
  expect(period).toMatchObject({ revenue: 0, cost: 40, contribution: -40 });
});

it("F2 fixes each partial success's food cents before a later success arrives", () => {
  const adjustment: ReturnAdjustment = { id: "a", order_id: "o", currency: "MXN", previous_total: 0.03,
    resulting_total: 0, previous_tip: 0, resulting_tip: 0, previous_service_fee: 0.02, resulting_service_fee: 0 };
  const operation = { id: "op", adjustment_id: "a", currency: "MXN", amount: 0.03, tip: 0 };
  const event = (id: string, day: number) => ({ id, operation_id: "op", amount_cents: 1,
    succeeded_at: `2026-11-0${day}T12:00:00Z` }) as ReturnEvent;
  const pieces = [event("one", 1), event("two", 2), event("three", 3)];
  const before = returnedFoodCents(adjustment, [operation], pieces.slice(0, 2));
  const after = returnedFoodCents(adjustment, [operation], pieces);
  expect([...before]).toEqual([["one", 0], ["two", 0]]);
  expect([...after]).toEqual([["one", 0], ["two", 0], ["three", 1]]);
});

it("F2 shares service only across principal, excluding a separate tip operation", () => {
  const adjustment: ReturnAdjustment = { id: "a", order_id: "o", currency: "MXN", previous_total: 100,
    resulting_total: 0, previous_tip: 20, resulting_tip: 0, previous_service_fee: 10, resulting_service_fee: 0 };
  const operations = [{ id: "principal", adjustment_id: "a", currency: "MXN", amount: 80, tip: 0 },
    { id: "tip", adjustment_id: "a", currency: "MXN", amount: 20, tip: 20 }];
  const events = operations.map(o => ({ id: o.id, operation_id: o.id, amount_cents: o.amount * 100,
    succeeded_at: "2026-11-01T12:00:00Z" }) as ReturnEvent);
  expect([...returnedFoodCents(adjustment, operations, events)]).toEqual([["principal", 7000], ["tip", 0]]);
});

it("F2 deducts a return once without undoing incurred fees or historical revenue", () => {
  const period = periodContribution([sale], 0.1, [{ order: sale, food: 30 }]);
  expect(period).toMatchObject({ revenue: 80, cost: 40, fees: 8, returned: 30, contribution: 2 });
  expect(period.rows[0]).toMatchObject({ units: 1, revenue: 80, cost: 40, returned: 30, contribution: 2 });
});


it("S9 F5: checkout keeps a product promotion off unrelated revenue and margin", () => {
  const items = [{ ...dish, qty: 2 }, { ...dish, itemId: "other", name: "Other" }];
  const pricing = priceCart({ items, servicePct: 0, serviceEnabled: false,
    promos: [{ id: "deal", name: "2x1", kind: "bogo", buyQty: 2, payQty: 1, itemIds: ["dish"] }] });
  const row = checkoutOrderRow({ restaurantId: "r", table: null, sessionId: null, diner: "d", deferred: true,
    pricing, taxPct: 0, couponCode: null, currency: "MXN", verified: items, note: undefined, customerName: undefined });
  const order = { ...row, ingredient_costs: [80, 40], created_at: "2026-11-10T12:00:00Z" };
  const analytics = computeAnalytics([order], "today", "UTC");
  expect(analytics.topProducts.find(p => p.name === "Other")?.revenue).toBe(100);
  expect(lineRevenues(order)).toEqual([100, 100]);
  const period = periodContribution([order], 0);
  expect(period.rows.find(r => r.name === "Other")).toMatchObject({ revenue: 100, contribution: 60 });
  expect(period.rows.find(r => r.name === "Dish")).toMatchObject({ revenue: 100, contribution: 20 });
});
