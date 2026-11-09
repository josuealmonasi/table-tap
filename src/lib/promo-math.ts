import { round2 } from "@/lib/money";
import { typedDecimal } from "@/lib/typed-decimal";
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

/**
 * What `qty` units cost under a promo, given the unit price the customer would
 * otherwise pay. Returns `qty * unit` when the promo doesn't apply, so callers
 * can always subtract this from the undiscounted cost to get the saving.
 */
/** The furthest ahead the cart's "add N more" hint looks. */
const MAX_HINT_UNITS = 12;
/** The largest basket of one product the deal maths prices exactly. */
const MAX_PRICED_UNITS = 10000;

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

  // Tiered: the cheapest way to make up `qty` from the brackets and single
  // units at their normal price. Largest-first charged four MX$10 items under
  // "2 for 15" and "3 for 25" as 25 + 10 = 35 when two pairs cost 30, and a
  // bracket that ended up dearer than its units (the product's price dropped
  // after the deal was saved) was still applied: a surcharge called a
  // promotion. Single units are always an option, so a deal can only ever
  // lower the bill, and a bigger basket is never priced above its units.
  // Whole units only, as the guard reads them. A tier of 1e-20 passed the
  // "positive" check, and subtracting it from 1 never changed the number: the
  // loop below spun for ever and froze the server for every restaurant.
  const tiers = (promo.tiers ?? [])
    .map(t => ({ qty: Math.floor(Number(t.qty)), price: Number(t.price) }))
    .filter(t => Number.isFinite(t.qty) && t.qty >= 1 && Number.isFinite(t.price) && t.price >= 0);
  if (tiers.length === 0 || !Number.isFinite(qty)) return round2(qty * unit);
  const unitCents = Math.round(unit * 100);
  let units = Math.floor(qty);
  // A huge basket is mostly copies of the best-value bracket: take those off
  // the top and price the last few thousand exactly. That is exact while the
  // brackets are small (every real deal); with a giant bracket the old
  // largest-first count is used, still never above the units' own price.
  let bulkCents = 0;
  if (units > MAX_PRICED_UNITS) {
    if (tiers.some(t => t.qty > 100)) return round2(Math.min(qty * unit, largestFirst(tiers, units, unit)));
    const bestTier = tiers.reduce((a, b) => b.price / b.qty < a.price / a.qty ? b : a);
    if (bestTier.price / bestTier.qty < unit) {
      const copies = Math.floor((units - MAX_PRICED_UNITS) / bestTier.qty) + 1;
      bulkCents = copies * Math.round(bestTier.price * 100);
      units -= copies * bestTier.qty;
    } else return round2(qty * unit);
  }
  const best = new Array<number>(units + 1).fill(Infinity);
  best[0] = 0;
  for (let n = 1; n <= units; n++) {
    let cheapest = best[n - 1] + unitCents;
    for (const tier of tiers) {
      if (tier.qty <= n) cheapest = Math.min(cheapest, best[n - tier.qty] + Math.round(tier.price * 100));
    }
    best[n] = cheapest;
  }
  return round2((bulkCents + best[units]) / 100);
}

/** The previous count: as many of the largest bracket as fit, then the next. */
function largestFirst(tiers: { qty: number; price: number }[], qty: number, unit: number): number {
  let left = qty, cost = 0;
  for (const tier of [...tiers].sort((a, b) => b.qty - a.qty)) {
    const times = Math.floor(left / tier.qty);
    cost += times * tier.price;
    left -= times * tier.qty;
  }
  return cost + left * unit;
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
  // Capped too: the horizon came from the deal's own numbers, and a tier of
  // 1e20 units would have priced the cart that many times.
  const horizon = Math.min(MAX_HINT_UNITS, Math.max(
    promo.kind === "bogo" ? Math.floor(Number(promo.buyQty) || 0) : 0,
    ...(promo.tiers ?? []).map(t => Math.floor(Number(t.qty) || 0)),
    1,
  ));
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
 * `base` is the unit price after the item's own % discount and `extrasPerUnit`
 * is folded into it, because a quantity deal applies to the whole unit: the
 * free half of a 2x1 is free as ordered, extras included.
 */
export function addedLineCost(
  promo: QuantityPromo | null | undefined,
  otherQty: number,
  qty: number,
  base: number,
  extrasPerUnit = 0,
): number {
  const unit = base + extrasPerUnit;
  const before = promo ? promoCost(promo, otherQty, unit) : otherQty * unit;
  const after = promo ? promoCost(promo, otherQty + qty, unit) : (otherQty + qty) * unit;
  return round2(after - before);
}

/**
 * The price breaks as an owner typed them, and whether every row is a real
 * break. A row with no price is not a break at MX$0: Number("") is 0, and a
 * number field the browser could not read ("12,50" on some phones) reports ""
 * too, so either way the deal used to give the dishes away. Prices read like
 * every other amount the team types.
 */
export function typedTiers(rows: { qty: string; price: string }[]): {
  tiers: { qty: number; price: number }[];
  complete: boolean;
} {
  const tiers = rows
    .map(row => ({ qty: Math.floor(Number(row.qty)), price: typedDecimal(row.price, 2) ?? NaN }))
    .filter(row => row.qty > 0 && Number.isFinite(row.price) && row.price > 0);
  return { tiers, complete: rows.length > 0 && tiers.length === rows.length };
}
