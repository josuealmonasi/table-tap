import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { priceCart } from "@/lib/pricing";
import { orderItemsWithRevenue } from "@/lib/order-line-revenue";
import { lineRevenues } from "@/lib/report-revenue";
import { offlineLines } from "@/lib/offline-sale";
import { offlineRevenueLines, sameOfflinePrice } from "@/lib/offline-pricing";
import { periodContribution } from "@/lib/costs/margins";
import type { OrderLineItem } from "@/lib/types";

const dish: OrderLineItem = { itemId: "dish", name: "Dish", emoji: "", price: 100, qty: 2, mods: {} };
const other = { ...dish, itemId: "other", name: "Other", qty: 1 };
const deal = { id: "deal", name: "2x1", kind: "bogo" as const, buyQty: 2, payQty: 1, itemIds: ["dish"] };
function price(items: OrderLineItem[], coupon = 0) {
  return priceCart({ items, servicePct: 0, serviceEnabled: false, promos: [deal],
    coupon: { code: "BILL", kind: "fixed", value: coupon } });
}
function order(items: OrderLineItem[], total: number) { return { items, total, service_fee: 0, tip: 0 }; }

it("only bill-wide discounts spread across the saved product promotion revenues", () => {
  const pricing = price([dish, other], 20);
  const saved = orderItemsWithRevenue([dish, other], pricing);
  expect(saved.map(l => l.promotionRevenue)).toEqual([100, 100]);
  expect(lineRevenues(order(saved, pricing.total))).toEqual([90, 90]);
  // A later staff discount takes another 20 once, without reallocating the deal.
  expect(lineRevenues(order(saved, pricing.total - 20))).toEqual([80, 80]);
  expect(lineRevenues(order(saved, 0))).toEqual([0, 0]);
});

it("does not overstate the promoted product or understate the unrelated product", () => {
  const items = orderItemsWithRevenue([dish, other], price([dish, other]));
  const result = periodContribution([{ ...order(items, 200), tax_pct: 0, ingredient_costs: [80, 40] }], 0);
  expect(result.rows.find(r => r.name === "Dish")).toMatchObject({ revenue: 100, contribution: 20 });
  expect(result.rows.find(r => r.name === "Other")).toMatchObject({ revenue: 100, contribution: 60 });
  expect(result).toMatchObject({ revenue: 200, cost: 120, contribution: 80 });
});

it("shares a product's promotion across its choices including extras, keeping exact cents", () => {
  const items = [{ ...dish, price: 0.01, qty: 1 }, { ...dish, price: 0.01, qty: 1,
    extras: [{ id: "extra", name: "Extra", emoji: "", price: 0.01 }] }, { ...other, price: 0.01 }];
  const pricing = price(items);
  const saved = orderItemsWithRevenue(items, pricing);
  expect(saved.map(l => l.promotionRevenue)).toEqual([0.01, 0.01, 0.01]);
  expect(lineRevenues(order(saved, pricing.total))).toEqual([0.01, 0.01, 0.01]);
  expect(items[0]).not.toHaveProperty("promotionRevenue");
});

it("keeps item sales and combo bundle pricing without deducting displayed combo savings again", () => {
  const items = [{ ...dish, discountPct: 20 }, { ...other, itemId: "combo", comboId: "combo", price: 50, comboRegular: 100 }];
  const pricing = price(items);
  const saved = orderItemsWithRevenue(items, pricing);
  expect(saved.map(l => l.promotionRevenue)).toEqual([80, 50]);
  expect(lineRevenues(order(saved, pricing.total))).toEqual([80, 50]);
});

it("keeps a free promoted product at zero while preserving its ingredient cost", () => {
  const items = [dish, other];
  const pricing = priceCart({ items, servicePct: 0, serviceEnabled: false, promos: [{ ...deal, payQty: 0 }] });
  const saved = orderItemsWithRevenue(items, pricing);
  expect(lineRevenues(order(saved, pricing.total))).toEqual([0, 100]);
  expect(periodContribution([{ ...order(saved, 100), tax_pct: 0, ingredient_costs: [80, 40] }], 0).rows
    .find(r => r.name === "Dish")).toMatchObject({ revenue: 0, cost: 80, contribution: -80 });
});

it("preserves today's proportional fallback for old receipts without snapshots", () => {
  expect(lineRevenues(order([dish, other], 200))).toEqual([133.33, 66.67]);
  expect(lineRevenues(order([{ ...dish, promotionRevenue: 100 }, other], 200))).toEqual([100, 100]);
});

it("offline replay preserves historical revenue and uses verified preparation facts", () => {
  const items = orderItemsWithRevenue([dish, other], price([dish, other]));
  const saved = offlineLines(items);
  // The verifier reorders lines; revenue follows identity, never array position.
  const replay = offlineRevenueLines(saved, [{ ...other, station: "bar" }, dish]);
  expect(replay.map(l => l.promotionRevenue)).toEqual([100, 100]);
  expect(replay[0].station).toBe("bar");
  expect(lineRevenues(order(replay, 200))).toEqual([100, 100]);
  expect(offlineRevenueLines(offlineLines([dish, other]), [dish, other])[0]).not.toHaveProperty("promotionRevenue");
});

it.each([[0, 200], [200, 0]])("requires manager review for forged offline attribution %j", (first, second) => {
  const items = [dish, other];
  const pricing = price(items);
  const charge = { ...pricing, at: "2026-11-10T12:00:00Z" };
  const saved = orderItemsWithRevenue(items, pricing);
  expect(sameOfflinePrice(charge, saved, { price: pricing, lines: items })).toBe(true);
  const forged = saved.map((l, i) => ({ ...l, promotionRevenue: i ? second : first }));
  expect(sameOfflinePrice(charge, forged, { price: pricing, lines: items })).toBe(false);
});

it("every new order writer freezes revenue and the till saves it before sending", () => {
  for (const file of ["src/lib/checkout/order-row.ts", "src/app/api/table-order/route.ts", "src/app/api/pos/order/route.ts"]) {
    expect(readFileSync(file, "utf8"), file).toMatch(/items: orderItemsWithRevenue\((?:o\.)?verified, pricing\)/);
  }
  expect(readFileSync("src/hooks/usePosCharge.ts", "utf8")).toContain("items: orderItemsWithRevenue(lines, pricing)");
  const offline = readFileSync("src/lib/pos-offline.ts", "utf8");
  expect(offline).toContain("approval ? savedLines : offlineRevenueLines(savedLines, current!.lines)");
  expect(offline).toContain("currency, items: lines");
});
