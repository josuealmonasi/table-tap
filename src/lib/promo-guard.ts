import { itemSalePrice } from "@/lib/pricing";

/** A product a promotion covers, with the price a diner would pay for one. */
export interface PricedProduct {
  id: string;
  price: number;
  discount_pct?: number | null;
}

export interface PromoShape {
  kind: "combo" | "bogo" | "tiered";
  comboPrice?: number | string | null;
  tiers?: { qty: number | string; price: number | string }[] | null;
  items: { itemId: string; qty: number }[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** What the promotion's products cost bought one by one. */
export function regularTotal(
  items: { itemId: string; qty: number }[],
  priced: Map<string, PricedProduct>,
): number {
  return round2(
    items.reduce((sum, i) => {
      const p = priced.get(i.itemId);
      if (!p) return sum;
      return sum + itemSalePrice(Number(p.price), p.discount_pct) * Math.max(1, i.qty);
    }, 0),
  );
}

/**
 * Rejects a promotion that would cost a diner *more* than simply buying the
 * products individually.
 *
 * A promotion exists to encourage an order, so one that charges a premium is
 * always a mistake — a mistyped price break, or a price edited downward after
 * the deal was written. Nothing downstream would catch it: the pricing engine
 * happily applies whatever the deal says, and the customer just sees a worse
 * number.
 *
 * Returns an error message, or null when the deal is genuinely a deal.
 */
export function promoPricingError(
  promo: PromoShape,
  priced: Map<string, PricedProduct>,
): string | null {
  if (promo.kind === "combo") {
    const regular = regularTotal(promo.items, priced);
    const price = Number(promo.comboPrice);
    if (regular > 0 && price >= regular) {
      return `A combo has to beat buying the products separately (${regular.toFixed(2)}).`;
    }
    return null;
  }

  if (promo.kind === "tiered") {
    // A tier replaces what that many units cost, and the promotion can cover
    // several products. The cheapest one decides: a break that beats the taco
    // can still overcharge for the water.
    const units = promo.items
      .map(i => priced.get(i.itemId))
      .filter((p): p is PricedProduct => Boolean(p))
      .map(p => itemSalePrice(Number(p.price), p.discount_pct));
    if (units.length === 0) return null;
    const cheapest = Math.min(...units);

    for (const tier of promo.tiers ?? []) {
      const qty = Math.floor(Number(tier.qty));
      const price = Number(tier.price);
      if (!Number.isFinite(qty) || qty < 1 || !Number.isFinite(price)) continue;
      const normal = round2(qty * cheapest);
      if (price >= normal) {
        return `Buying ${qty} costs ${normal.toFixed(2)} already — the price break has to be lower.`;
      }
    }
    return null;
  }

  // bogo is already required to pay for fewer than it takes, so it always saves.
  return null;
}
