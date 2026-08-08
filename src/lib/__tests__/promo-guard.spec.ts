import { describe, expect, it } from "vitest";
import { promoPricingError, regularTotal, type PricedProduct } from "@/lib/promo-guard";

const priced = new Map<string, PricedProduct>([
  ["taco", { id: "taco", price: 10.5 }],
  ["water", { id: "water", price: 2.5 }],
  ["sale", { id: "sale", price: 10, discount_pct: 50 }],
]);

describe("regularTotal", () => {
  it("sums the sale price, not the list price", () => {
    expect(regularTotal([{ itemId: "sale", qty: 2 }], priced)).toBe(10);
  });
});

describe("promoPricingError — tiered", () => {
  const tier = (qty: number, price: number) => ({
    kind: "tiered" as const,
    items: [{ itemId: "taco", qty: 1 }],
    tiers: [{ qty, price }],
  });

  it("rejects the reported case: 2 tacos for 30 when two cost 21", () => {
    expect(promoPricingError(tier(2, 30), priced)).toMatch(/21\.00/);
  });

  it("rejects a break priced exactly at the normal total", () => {
    expect(promoPricingError(tier(2, 21), priced)).not.toBeNull();
  });

  it("accepts a genuine saving", () => {
    expect(promoPricingError(tier(2, 18), priced)).toBeNull();
  });

  it("judges against the cheapest covered product", () => {
    // 2 for 6 beats two tacos (21) but overcharges for two waters (5).
    const mixed = {
      kind: "tiered" as const,
      items: [
        { itemId: "taco", qty: 1 },
        { itemId: "water", qty: 1 },
      ],
      tiers: [{ qty: 2, price: 6 }],
    };
    expect(promoPricingError(mixed, priced)).toMatch(/5\.00/);
  });
});

describe("promoPricingError — combo", () => {
  const combo = (price: number) => ({
    kind: "combo" as const,
    comboPrice: price,
    items: [
      { itemId: "taco", qty: 1 },
      { itemId: "water", qty: 1 },
    ],
  });

  it("rejects a bundle dearer than its parts", () => {
    expect(promoPricingError(combo(15), priced)).toMatch(/13\.00/);
  });

  it("rejects a bundle priced at exactly its parts", () => {
    expect(promoPricingError(combo(13), priced)).not.toBeNull();
  });

  it("accepts a bundle that saves", () => {
    expect(promoPricingError(combo(11), priced)).toBeNull();
  });
});

describe("promoPricingError — bogo", () => {
  it("always saves, since paying for fewer is enforced elsewhere", () => {
    expect(
      promoPricingError(
        { kind: "bogo", items: [{ itemId: "taco", qty: 1 }] },
        priced,
      ),
    ).toBeNull();
  });
});
