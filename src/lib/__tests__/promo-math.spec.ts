import { describe, it, expect } from "vitest";
import { promoCost, nextPromoStep, type QuantityPromo } from "@/lib/promo-math";

const bogo = (buyQty: number, payQty: number): QuantityPromo => ({
  id: "p1",
  name: `${buyQty}x${payQty}`,
  kind: "bogo",
  buyQty,
  payQty,
});

const tiered = (tiers: { qty: number; price: number }[]): QuantityPromo => ({
  id: "p2",
  name: "tiered",
  kind: "tiered",
  tiers,
});

describe("promoCost — bogo", () => {
  it("2x1: two cost the price of one", () => {
    expect(promoCost(bogo(2, 1), 2, 5)).toBe(5);
  });

  it("2x1: charges for the odd one out", () => {
    expect(promoCost(bogo(2, 1), 1, 5)).toBe(5);
    expect(promoCost(bogo(2, 1), 3, 5)).toBe(10); // one pair + one single
    expect(promoCost(bogo(2, 1), 4, 5)).toBe(10); // two pairs
  });

  it("3x1: three for the price of one", () => {
    expect(promoCost(bogo(3, 1), 3, 6)).toBe(6);
    // 7 = two groups of 3 (pay 1 each = 12) + 1 left over at full price (6)
    expect(promoCost(bogo(3, 1), 7, 6)).toBe(18);
  });

  it("3x2 works too", () => {
    expect(promoCost(bogo(3, 2), 3, 5)).toBe(10);
  });

  it("ignores a misconfigured deal rather than giving stock away", () => {
    expect(promoCost(bogo(0, 0), 3, 5)).toBe(15);
    expect(promoCost(bogo(2, 2), 3, 5)).toBe(15); // pay >= buy is no discount
    expect(promoCost(bogo(2, 3), 3, 5)).toBe(15);
  });
});

describe("promoCost — tiered", () => {
  const drinks = tiered([
    { qty: 1, price: 5 },
    { qty: 2, price: 8 },
  ]);

  it("prices the user's example: 1 for 5, 2 for 8", () => {
    expect(promoCost(drinks, 1, 5)).toBe(5);
    expect(promoCost(drinks, 2, 5)).toBe(8);
  });

  it("takes the biggest bracket first, then charges the remainder", () => {
    expect(promoCost(drinks, 3, 5)).toBe(13); // one 2-pack (8) + one single (5)
    expect(promoCost(drinks, 4, 5)).toBe(16); // two 2-packs
  });

  it("never gets worse as the basket grows", () => {
    let prev = 0;
    for (let q = 1; q <= 10; q++) {
      const cost = promoCost(drinks, q, 5);
      expect(cost).toBeGreaterThanOrEqual(prev);
      prev = cost;
    }
  });

  it("falls back to unit price with no usable tiers", () => {
    expect(promoCost(tiered([]), 3, 5)).toBe(15);
    expect(promoCost(tiered([{ qty: 0, price: 1 }]), 3, 5)).toBe(15);
  });
});

describe("promoCost — edges", () => {
  it("is zero for an empty quantity", () => {
    expect(promoCost(bogo(2, 1), 0, 5)).toBe(0);
  });

  it("handles a free item without going negative", () => {
    expect(promoCost(bogo(2, 1), 3, 0)).toBe(0);
  });
});

describe("nextPromoStep", () => {
  it("2x1 at qty 1: add one more and the second is free", () => {
    expect(nextPromoStep(bogo(2, 1), 1, 5)).toEqual({ addQty: 1, save: 5 });
  });

  it("tiered 1-for-5 / 2-for-8: adding a second saves 2 (the user's example)", () => {
    const drinks = tiered([
      { qty: 1, price: 5 },
      { qty: 2, price: 8 },
    ]);
    expect(nextPromoStep(drinks, 1, 5)).toEqual({ addQty: 1, save: 2 });
  });

  it("looks past a step that saves nothing to the one that does", () => {
    // On 2x1 with a pair already in the cart, a 3rd is full price — but a 4th
    // completes another pair, so the useful nudge is "add 2 and save 5".
    expect(nextPromoStep(bogo(2, 1), 2, 5)).toEqual({ addQty: 2, save: 5 });
  });

  it("says nothing when the deal can never pay off", () => {
    // A tier priced at exactly 2 × unit is no discount at all.
    expect(nextPromoStep(tiered([{ qty: 2, price: 10 }]), 0, 5)).toBeNull();
  });

  it("returns null for a deal that never discounts", () => {
    expect(nextPromoStep(bogo(2, 2), 1, 5)).toBeNull();
  });
});
