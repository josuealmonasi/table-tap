import { expect, it } from "vitest";
import { computeAnalytics } from "@/lib/analytics";
import { periodContribution } from "@/lib/costs/margins";
import { recipeBook, unitCosts } from "@/lib/costs/recipe-cost";
import { foodRevenue, lineRevenues } from "@/lib/report-revenue";
import { priceCart } from "@/lib/pricing";

const dish = { itemId: "dish", name: "Dish", emoji: "🍜", price: 100, qty: 1, mods: {} };
const book = recipeBook([{ item_id: "dish", ingredient_id: "food", quantity: 1, mod_label: null, mod_option: null }]);
const costs = unitCosts([{ id: "food", unit_cost: 40 }]);
const sale = {
  items: [dish], subtotal: 100, total: 80, service_fee: 0, tip: 0, tax_pct: 0,
  created_at: "2026-10-21T12:00:00Z",
};

it("I11/J11: a later MX$20 table discount leaves MX$80 product revenue and MX$40 contribution", () => {
  const analytics = computeAnalytics([sale], "today", "UTC");
  const period = periodContribution([sale], book, costs, 0);
  expect(analytics.revenue).toBe(80);
  expect(analytics.topProducts[0].revenue).toBe(80);
  expect(period.revenue).toBe(80);
  expect(period.contribution).toBe(40);
});

it("shares final food revenue once, keeping service, tips and inclusive IVA separate", () => {
  // MX$100 food was discounted at checkout to MX$80, then by another MX$20.
  const order = { ...sale, subtotal: 80, total: 90, service_fee: 10, tip: 20, tax_pct: 20 };
  const analytics = computeAnalytics([order], "today", "UTC");
  const period = periodContribution([order], book, costs, 0.1);
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
  const period = periodContribution([order], book, costs, 0);
  expect(period.rows.map(r => r.revenue).sort((a, b) => b - a)).toEqual([80, 40]);
});

it("allocates a cent once across three products", () => {
  const order = { ...sale, total: 0.01, items: [dish, { ...dish, itemId: "two" }, { ...dish, itemId: "three" }] };
  expect(lineRevenues(order)).toEqual([0.01, 0, 0]);
  expect(computeAnalytics([order], "today", "UTC").topProducts.reduce((s, p) => s + p.revenue, 0)).toBe(0.01);
  const period = periodContribution([order], book, costs, 0);
  expect(period.revenue + period.uncosted).toBe(0.01);
});

it("keeps a fully discounted sale's ingredient cost without negative food revenue", () => {
  const order = { ...sale, total: 10, service_fee: 10, tip: 10 };
  const period = periodContribution([order], book, costs, 0);
  expect(foodRevenue(order)).toBe(0);
  expect(period).toMatchObject({ revenue: 0, cost: 40, contribution: -40 });
});
