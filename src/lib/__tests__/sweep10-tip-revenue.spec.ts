import { expect, it } from "vitest";
import { computeAnalytics } from "@/lib/analytics";
import { periodContribution } from "@/lib/costs/margins";
import { corteFrom } from "@/lib/corte";

const now = new Date("2026-11-10T18:00:00Z");
const sale = {
  total: 130, tip: 20, service_fee: 10, tax_pct: 0, ingredient_costs: [40],
  created_at: now.toISOString(),
  items: [{ itemId: "dish", name: "Dish", emoji: "", price: 100, qty: 1, mods: {} }],
};
const analytics = (order = sale) => computeAnalytics([order], "today", "UTC", now);

it("F3: revenue and average ticket exclude staff tips while retaining service", () => {
  expect(analytics()).toMatchObject({ revenue: 110, avgTicket: 110, tips: 20, orderCount: 1 });
  expect(analytics({ ...sale, total: 160, tip: 50 }).revenue).toBe(110);
});

it("F3: daily revenue bars exclude staff tips", () => {
  expect(analytics().byDay.map(d => d.revenue)).toEqual([110]);
});

it("F3: returns restore original revenue and tips separately, including returned tips", () => {
  const returned = { ...sale, total: 0, tip: 0, service_fee: 0,
    return_components: { total: 130, tip: 20, service_fee: 10 } };
  const data = computeAnalytics([returned], "today", "UTC", now);
  expect(data).toMatchObject({ revenue: 110, avgTicket: 110, tips: 20, byDay: [{ revenue: 110 }] });
  expect(data.topProducts[0].revenue).toBe(100);
  expect(periodContribution([returned], 0)).toMatchObject({ revenue: 100, contribution: 60 });
});

it("F3: margins already exclude tips; corte still expects all cash received", () => {
  expect(periodContribution([sale], 0)).toMatchObject({ revenue: 100, contribution: 60 });
  const cash = { amount: sale.total, tip: sale.tip, method: "cash", actor_email: "cashier" };
  expect(corteFrom([cash]).totals).toMatchObject({ cash: 130, total: 130 });
  expect(corteFrom([cash], [{ action: "refunded", detail: "amount=130 method=cash collector=cashier" }]).totals.cash).toBe(0);
});

it("F3: Postgres numeric strings exclude tips without string concatenation", () => {
  const numeric = { ...sale, total: "130.00", tip: "20.00" } as unknown as typeof sale;
  expect(analytics(numeric)).toMatchObject({ revenue: 110, avgTicket: 110, tips: 20 });
});
