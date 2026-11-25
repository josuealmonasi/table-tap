import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bestPromoFor, MAX_LINE_QTY, priceCart, type CartPromo } from "@/lib/pricing";
import { fetchPromotions } from "@/lib/promotions-data";
import type { OrderLineItem } from "@/lib/types";

const twoForOne: CartPromo = {
  id: "b", name: "2x1", kind: "bogo", buyQty: 2, payQty: 1, itemIds: ["dish"],
};
const threeForTwo: CartPromo = {
  id: "a", name: "3x2", kind: "bogo", buyQty: 3, payQty: 2, itemIds: ["dish"],
};

function line(qty: number, price = 100): OrderLineItem {
  return { itemId: "dish", name: "Dish", emoji: "", price, qty, mods: {} } as OrderLineItem;
}

const total = (items: OrderLineItem[], promos: CartPromo[]): number =>
  priceCart({ items, promos, servicePct: 0, serviceEnabled: false }).total;

describe("tied promotions price the same in either order", () => {
  it("two MX$100 dishes under tied 2x1 and 3x2 cost MX$100 both ways", () => {
    // Taking the first deal in the list priced this cart at MX$100 or MX$200
    // depending on which row the database returned first.
    expect(total([line(2)], [twoForOne, threeForTwo])).toBe(100);
    expect(total([line(2)], [threeForTwo, twoForOne])).toBe(100);
  });

  it("picks the deal that saves the most for the current cart", () => {
    // Three units: 2x1 saves 100 (pay 2 of 3), 3x2 saves 100 too; six units:
    // 2x1 saves 300, 3x2 saves 200.
    expect(bestPromoFor([threeForTwo, twoForOne], "dish", 6, 100)).toMatchObject({ promo: twoForOne, saved: 300 });
    expect(total([line(6)], [threeForTwo, twoForOne])).toBe(300);
  });

  it("never takes a deal that saves nothing over one that saves something", () => {
    const never: CartPromo = { id: "c", name: "never", kind: "bogo", buyQty: 2, payQty: 2, itemIds: ["dish"] };
    expect(bestPromoFor([never, twoForOne], "dish", 2, 100)?.promo).toBe(twoForOne);
  });

  it("breaks an exact tie by list position, which the loader fixes", () => {
    expect(bestPromoFor([threeForTwo, twoForOne], "dish", 3, 100)?.promo).toBe(threeForTwo);
    expect(bestPromoFor([twoForOne, threeForTwo], "dish", 3, 100)?.promo).toBe(twoForOne);
  });
});

describe("the promotion loader orders deterministically", () => {
  it("sorts by sort_order, then id", async () => {
    const orders: string[] = [];
    const query = {
      select: () => query,
      eq: () => query,
      order: (column: string) => { orders.push(column); return query; },
      then: (resolve: (r: { data: unknown[]; error: null }) => void) => resolve({ data: [], error: null }),
    };
    const supabase = { from: () => query } as unknown as SupabaseClient;
    await fetchPromotions(supabase, "r1", { activeOnly: true });
    expect(orders).toEqual(["sort_order", "id"]);
  });
});

describe("an oversized line", () => {
  it("is discounted on the same capped quantity it is charged for", () => {
    // Charged for 99 (MX$990) while the deal maths read 100 units and took
    // MX$1,000 off: a discount larger than the charge.
    const priced = priceCart({
      items: [line(100, 10)],
      promos: [{ ...twoForOne, buyQty: 1, payQty: 0 }],
      servicePct: 0,
      serviceEnabled: false,
    });
    expect(priced.grossSubtotal).toBe(MAX_LINE_QTY * 10);
    expect(priced.promoDiscount).toBeLessThanOrEqual(priced.grossSubtotal);
    expect(priced.promoDiscount).toBe(MAX_LINE_QTY * 10);
    expect(priced.subtotal).toBe(0);

    const half = priceCart({ items: [line(100, 10)], promos: [twoForOne], servicePct: 0, serviceEnabled: false });
    expect(half.promoDiscount).toBe(490); // 49 free of 99, not 50 free of 100
  });
});
