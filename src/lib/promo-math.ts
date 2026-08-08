// Quantity-deal maths: what a given number of one product actually costs.
// Pure and self-contained so the pricing engine stays readable and this can be
// unit-tested on its own.

/** A "buy N, pay M" deal (2x1 → buy 2, pay 1) or bracket pricing. */
export interface QuantityPromo {
  id: string;
  name: string;
  kind: "bogo" | "tiered";
  /** kind='bogo': how many the customer takes. */
  buyQty?: number | null;
  /** kind='bogo': how many they pay for. */
  payQty?: number | null;
  /** kind='tiered': e.g. [{ qty: 1, price: 5 }, { qty: 2, price: 8 }]. */
  tiers?: { qty: number; price: number }[] | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * What `qty` units cost under a promo, given the unit price the customer would
 * otherwise pay. Returns `qty * unit` when the promo doesn't apply, so callers
 * can always subtract this from the undiscounted cost to get the saving.
 */
export function promoCost(promo: QuantityPromo, qty: number, unit: number): number {
  if (qty <= 0 || unit < 0) return 0;

  if (promo.kind === "bogo") {
    const buy = Math.floor(promo.buyQty ?? 0);
    const pay = Math.floor(promo.payQty ?? 0);
    // A deal that doesn't actually discount (or is misconfigured) is ignored.
    if (buy <= 0 || pay < 0 || pay >= buy) return round2(qty * unit);
    const groups = Math.floor(qty / buy);
    const remainder = qty % buy;
    return round2((groups * pay + remainder) * unit);
  }

  // Tiered: repeatedly take the largest bracket that still fits, then charge
  // the leftovers at the normal unit price. Largest-first keeps it predictable
  // and means a bigger basket is never worse than a smaller one.
  const tiers = (promo.tiers ?? [])
    .filter(t => t.qty > 0 && t.price >= 0)
    .sort((a, b) => b.qty - a.qty);
  if (tiers.length === 0) return round2(qty * unit);

  let left = qty;
  let cost = 0;
  for (const tier of tiers) {
    while (left >= tier.qty) {
      cost += tier.price;
      left -= tier.qty;
    }
  }
  return round2(cost + left * unit);
}

/**
 * The smallest number of extra units worth adding, and what that saves versus
 * paying the normal price for them. This is what powers the cart nudge
 * ("add 1 more and save $2"). Returns null when adding more saves nothing.
 */
export function nextPromoStep(
  promo: QuantityPromo,
  qty: number,
  unit: number,
): { addQty: number; save: number } | null {
  // Only look a small distance ahead — a hint to add six more drinks is noise.
  const horizon = Math.max(
    promo.kind === "bogo" ? (promo.buyQty ?? 0) : 0,
    ...(promo.tiers ?? []).map(t => t.qty),
    1,
  );
  const current = promoCost(promo, qty, unit);
  for (let add = 1; add <= horizon; add++) {
    const save = round2(current + add * unit - promoCost(promo, qty + add, unit));
    if (save > 0) return { addQty: add, save };
  }
  return null;
}

/**
 * What adding `qty` more of a product actually costs, given `otherQty` of it
 * already in the cart.
 *
 * A quantity deal applies across every line of the product, so a line's cost
 * is not `qty * unit` — the second unit of a 2x1 is free only because the
 * first one is there. Pricing the cart before and after and taking the
 * difference is the only figure that matches what checkout will charge.
 *
 * `base` is the unit price after the item's own % discount; `extrasPerUnit` is
 * added afterwards because extras are never discounted.
 */
export function addedLineCost(
  promo: QuantityPromo | null | undefined,
  otherQty: number,
  qty: number,
  base: number,
  extrasPerUnit = 0,
): number {
  const before = promo ? promoCost(promo, otherQty, base) : otherQty * base;
  const after = promo ? promoCost(promo, otherQty + qty, base) : (otherQty + qty) * base;
  return round2(after - before + extrasPerUnit * qty);
}
