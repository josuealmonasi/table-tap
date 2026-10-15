import { describe, expect, it } from "vitest";
import { packLabel, packPrice, packSize, recipeQuantity, supplierName, terminalFeePct, ingredientName } from "@/lib/costs/input";
import { defaultChoices, dishCost, lineCost, recipeBook, unitCosts, type RecipeLine } from "@/lib/costs/recipe-cost";
import { feeRate, paymentFee } from "@/lib/costs/fees";
import { periodContribution, unitMargin, unitMargins, type CostedItem } from "@/lib/costs/margins";
import { priceRises } from "@/lib/costs/price-rises";
import type { OrderLineItem } from "@/lib/types";

const line = (item_id: string, ingredient_id: string, quantity: number, mod?: [string, string]): RecipeLine => ({
  item_id, ingredient_id, quantity, mod_label: mod?.[0] ?? null, mod_option: mod?.[1] ?? null,
});

// A latte: 18 g of coffee, a cup, and either 200 ml of whole or of oat milk.
const book = recipeBook([
  line("latte", "coffee", 18),
  line("latte", "cup", 1),
  line("latte", "milk", 200, ["Leche", "Entera"]),
  line("latte", "oat", 200, ["Leche", "Avena"]),
  line("shot", "coffee", 9),
]);
const costs = unitCosts([
  { id: "coffee", unit_cost: 0.4 }, // MX$400 a kilo
  { id: "cup", unit_cost: 2 },
  { id: "milk", unit_cost: 0.025 }, // MX$25 a litre
  { id: "oat", unit_cost: 0.06 },
]);
const latte: CostedItem = {
  id: "latte", name: "Latte", emoji: "☕", price: 58, discount_pct: 0, is_addon: false,
  modifiers: [{ label: "Leche", type: "single", options: ["Entera", "Avena"] }],
};

describe("what an owner types about an ingredient", () => {
  it("stores a pack in the small unit", () => {
    expect(packSize("1", "kg", "g")).toBe(1000);
    expect(packSize("1.5", "l", "ml")).toBe(1500);
    expect(packSize("50", "pza", "pza")).toBe(50);
    expect(packSize("250", "g", "g")).toBe(250);
  });

  it("refuses a pack unit the ingredient does not come in, and an empty pack", () => {
    expect(packSize("1", "l", "g")).toBeNull();
    expect(packSize("1", "kg", "pza")).toBeNull();
    expect(packSize("0", "g", "g")).toBeNull();
    expect(packSize("-1", "g", "g")).toBeNull();
  });

  it("reads prices and quantities as people type them", () => {
    expect(packPrice("1,250.50")).toBe(1250.5);
    expect(packPrice("0")).toBe(0);
    expect(packPrice("12.345")).toBeNull();
    expect(recipeQuantity("0.5")).toBe(0.5);
    expect(recipeQuantity("0")).toBeNull();
    expect(terminalFeePct("3.5")).toBe(3.5);
    expect(terminalFeePct("16")).toBeNull();
  });

  it("trims names, and refuses ones that are too long", () => {
    expect(ingredientName("  Leche   entera ")).toBe("Leche entera");
    expect(ingredientName(" ")).toBeNull();
    expect(ingredientName("x".repeat(81))).toBeNull();
    expect(supplierName("")).toBeNull();
    expect(supplierName(7)).toBe("bad");
  });

  it("shows a whole kilo as a kilo", () => {
    expect(packLabel(1000, "g")).toEqual({ size: 1, unit: "kg" });
    expect(packLabel(2000, "ml")).toEqual({ size: 2, unit: "l" });
    expect(packLabel(250, "g")).toEqual({ size: 250, unit: "g" });
    expect(packLabel(1000, "pza")).toEqual({ size: 1000, unit: "pza" });
  });
});

describe("what a product costs to make", () => {
  it("counts a choice's ingredients only when it was chosen", () => {
    // 18 × 0.4 + 2 = 9.20, then the milk.
    expect(dishCost("latte", { Leche: "Entera" }, book, costs)).toBeCloseTo(9.2 + 5);
    expect(dishCost("latte", { Leche: "Avena" }, book, costs)).toBeCloseTo(9.2 + 12);
    expect(dishCost("latte", {}, book, costs)).toBeCloseTo(9.2);
  });

  it("says so when a product has no recipe", () => {
    expect(dishCost("croissant", {}, book, costs)).toBeNull();
  });

  it("costs a product by the first option of each single choice", () => {
    expect(defaultChoices(latte.modifiers)).toEqual({ Leche: "Entera" });
    expect(defaultChoices([{ label: "Extras", type: "multi", options: ["Canela"] }])).toEqual({});
  });

  it("costs a sold line with its extras, times how many", () => {
    const sold: OrderLineItem = {
      itemId: "latte", name: "Latte", emoji: "☕", price: 58, qty: 2, mods: { Leche: "Avena" },
      extras: [{ id: "shot", name: "Extra shot", emoji: "☕", price: 10 }],
    };
    // (21.20 + 3.60) × 2
    expect(lineCost(sold, book, costs)).toEqual({ cost: expect.closeTo(49.6), complete: true });
  });

  it("marks a line incomplete when something on it has no recipe", () => {
    const sold: OrderLineItem = {
      itemId: "latte", name: "Latte", emoji: "☕", price: 58, qty: 1, mods: { Leche: "Entera" },
      extras: [{ id: "syrup", name: "Vainilla", emoji: "🍯", price: 8 }],
    };
    expect(lineCost(sold, book, costs).complete).toBe(false);
    expect(lineCost(sold, book, costs).cost).toBeCloseTo(14.2);
  });

  it("costs a combo by the dishes inside it", () => {
    const combo: OrderLineItem = {
      itemId: "combo-1", comboId: "combo-1", name: "Desayuno", emoji: "🥐", price: 90, qty: 1, mods: {},
      components: [{ itemId: "latte", name: "Latte", emoji: "☕", qty: 1, mods: { Leche: "Entera" } },
        { itemId: "shot", name: "Shot", emoji: "☕", qty: 2 }],
    };
    expect(lineCost(combo, book, costs).cost).toBeCloseTo(14.2 + 7.2);
  });
});

describe("what taking the money costs", () => {
  it("charges Stripe's rate plus IVA, the terminal's rate, and nothing for cash", () => {
    expect(paymentFee({ amount: 1000, method: "card", stripe_payment_intent: "pi_1" }, 3.5)).toBeCloseTo(45.24);
    expect(paymentFee({ amount: 1000, method: "card", stripe_payment_intent: null }, 3.5)).toBeCloseTo(35);
    expect(paymentFee({ amount: 1000, method: "cash", stripe_payment_intent: null }, 3.5)).toBe(0);
  });

  it("makes one rate of the period's mix, TableTap's fee included", () => {
    const r = feeRate([
      { amount: 1000, method: "cash", stripe_payment_intent: null },
      { amount: 1000, method: "card", stripe_payment_intent: null },
    ], 5, 3.5);
    expect(r.rate).toBeCloseTo(40 / 2000);
    expect(r).toMatchObject({ takings: 2000, cash: 1000, terminal: 1000, online: 0 });
  });

  it("is nothing when nothing was taken", () => {
    expect(feeRate([], 0, 3.5).rate).toBe(0);
  });
});

describe("what a product leaves", () => {
  it("takes IVA, ingredients and the fee off the price", () => {
    const m = unitMargin(latte, book, costs, 0.02, 16);
    expect(m.net).toBeCloseTo(50);
    expect(m.cost).toBeCloseTo(14.2);
    expect(m.fee).toBeCloseTo(1.16);
    expect(m.margin).toBeCloseTo(50 - 14.2 - 1.16);
    expect(m.marginPct).toBeCloseTo((50 - 14.2 - 1.16) / 50);
  });

  it("puts the thinnest margins first and the products with no recipe last", () => {
    const croissant: CostedItem = { ...latte, id: "croissant", name: "Croissant", modifiers: [] };
    const shot: CostedItem = { ...latte, id: "shot", name: "Shot", price: 10, modifiers: [] };
    expect(unitMargins([croissant, latte, shot], book, costs, 0, 0).map(m => m.itemId)).toEqual(["shot", "latte", "croissant"]);
  });

  it("shares an order's discount across its lines and adds up the period", () => {
    const orders = [{
      subtotal: 87, tax_pct: 0, // MX$116 of lines with MX$29 off the order
      items: [
        { itemId: "latte", name: "Latte", emoji: "☕", price: 58, qty: 2, mods: { Leche: "Entera" } },
      ] as OrderLineItem[],
    }];
    const p = periodContribution(orders, book, costs, 0);
    expect(p.revenue).toBeCloseTo(87);
    expect(p.cost).toBeCloseTo(28.4);
    expect(p.contribution).toBeCloseTo(87 - 28.4);
    expect(p.rows[0]).toMatchObject({ key: "latte", units: 2, complete: true });
    expect(p.uncosted).toBe(0);
  });

  it("keeps sales it cannot cost out of the totals, and names them", () => {
    const orders = [{ subtotal: 88, tax_pct: 0, items: [
      { itemId: "croissant", name: "Croissant", emoji: "🥐", price: 30, qty: 1, mods: {} },
      { itemId: "latte", name: "Latte", emoji: "☕", price: 58, qty: 1, mods: { Leche: "Entera" } },
    ] as OrderLineItem[] }];
    const p = periodContribution(orders, book, costs, 0);
    expect(p.uncosted).toBeCloseTo(30);
    expect(p.revenue).toBeCloseTo(58);
    expect(p.contribution).toBeCloseTo(58 - 14.2);
    expect(p.rows.find(r => r.key === "croissant")).toMatchObject({ units: 1, complete: false });
  });
});

describe("a supplier's rise", () => {
  const ingredients = [
    { id: "milk", name: "Leche entera", unit: "ml" as const, pack_size: 1000, pack_price: 30, unit_cost: 0.03, supplier: null },
    { id: "oat", name: "Leche de avena", unit: "ml" as const, pack_size: 1000, pack_price: 70, unit_cost: 0.07, supplier: null },
  ];
  const now = unitCosts([...ingredients, { id: "coffee", unit_cost: 0.4 }, { id: "cup", unit_cost: 2 }]);

  it("names each product it made thinner, and by how much", () => {
    const rises = priceRises(
      [{ ingredient_id: "milk", previous_cost: 0.025, unit_cost: 0.03, created_at: "2026-10-10T10:00:00Z" }],
      ingredients, [latte], book, now, 0, 0,
    );
    expect(rises).toHaveLength(1);
    expect(rises[0]).toMatchObject({ ingredientId: "milk", before: 0.025, after: 0.03 });
    expect(rises[0].products[0].marginBefore - rises[0].products[0].marginAfter).toBeCloseTo(1);
  });

  it("leaves out a product the rise does not move at its default", () => {
    const rises = priceRises(
      [{ ingredient_id: "oat", previous_cost: 0.06, unit_cost: 0.07, created_at: "2026-10-10T10:00:00Z" }],
      ingredients, [latte], book, now, 0, 0,
    );
    expect(rises[0].products).toEqual([]);
  });

  it("ignores the price an ingredient was created with, and a fall", () => {
    expect(priceRises([
      { ingredient_id: "milk", previous_cost: null, unit_cost: 0.03, created_at: "2026-10-09T10:00:00Z" },
      { ingredient_id: "oat", previous_cost: 0.09, unit_cost: 0.07, created_at: "2026-10-10T10:00:00Z" },
    ], ingredients, [latte], book, now, 0, 0)).toEqual([]);
  });
});
