import { describe, expect, it } from "vitest";
import { priceCart, tipFor } from "@/lib/pricing";
import type { OrderLineItem } from "@/lib/types";

const dish = (over: Partial<OrderLineItem> = {}): OrderLineItem => ({
  itemId: "i1", name: "Dish", emoji: "x", price: 100, qty: 1, mods: {}, ...over,
});
const cart = (over: Record<string, unknown> = {}) =>
  priceCart({ items: [dish()], promotions: [], servicePct: 0, serviceEnabled: false, ...over } as never);

/**
 * A tip is a gratuity, not a discount.
 *
 * The diner's checkout only ever sends 0/10/15/20 from an allow-list, so it was
 * safe. The till passed the request's number straight through, and a NEGATIVE
 * percentage came out as a negative tip — charging less than the food costs.
 * The drawer still reconciled afterwards, because the order's own total was
 * computed with the same negative number, so nothing downstream would notice.
 */
describe("the tip cannot make a sale cheaper", () => {
  it("refuses a negative percentage", () => {
    expect(tipFor(100, -50)).toBe(0);
    expect(cart({ tipPct: -50 }).tip).toBe(0);
    expect(cart({ tipPct: -50 }).total).toBe(100);
  });

  it("never exceeds the food it is thanking somebody for", () => {
    expect(tipFor(100, 1000)).toBe(100);
    expect(cart({ tipPct: 1000 }).tip).toBeLessThanOrEqual(100);
  });

  it("refuses a negative exact amount", () => {
    expect(cart({ tipAmount: -100 }).tip).toBe(0);
    expect(cart({ tipAmount: -100 }).total).toBe(100);
  });

  it("treats a number that is not one as no tip at all", () => {
    expect(tipFor(100, NaN)).toBe(0);
    expect(tipFor(100, Infinity)).toBe(0);
    expect(cart({ tipAmount: Number.NaN }).tip).toBe(0);
    expect(cart({ tipAmount: Infinity }).tip).toBe(0);
  });

  it("still takes an honest tip", () => {
    expect(tipFor(100, 15)).toBe(15);
    expect(cart({ tipPct: 15 }).total).toBe(115);
    expect(cart({ tipAmount: 7.5 }).total).toBe(107.5);
  });
});
