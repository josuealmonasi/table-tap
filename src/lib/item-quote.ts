import { round2 } from "@/lib/money";
import { itemSalePrice, priceCart, type CartPromo } from "@/lib/pricing";
import type { OrderLineItem } from "@/lib/types";

/** What the dish screen quotes for the line it is about to add. */
export interface ItemQuote {
  /** What adding the line moves the cart's goods total by. */
  total: number;
  /** The same units at their own price, with no deal. */
  full: number;
  /** A deal lowers this line's cost. */
  applied: boolean;
  /** The deal this product gets, for the callout; null when none covers it. */
  promoName: string | null;
  /** "Add N more and save X", when the deal is not yet reached. */
  step: { addQty: number; save: number } | null;
}

/** The cart's goods total: no coupon, no service charge, no tip. */
function goods(items: OrderLineItem[], promos: CartPromo[]): ReturnType<typeof priceCart> {
  return priceCart({ items, promos, servicePct: 0, serviceEnabled: false });
}

/**
 * The dish screen's price for a line: the cart priced before and after adding
 * it, with the same priceCart the cart and checkout use.
 *
 * A quantity deal applies across every line of a product, at the cheapest
 * unit among them, so no per-line formula can match the cart. One did: with a
 * plain MX$10 dish in the cart under 2x1, adding a second with a MX$5 extra
 * was quoted MX$0 while the cart went up by MX$5.
 *
 * `cart` is every other line in the cart — when editing a line, without it.
 */
export function quoteItemLine(
  cart: OrderLineItem[],
  line: OrderLineItem,
  promos: CartPromo[],
): ItemQuote {
  const before = goods(cart, promos);
  const after = goods([...cart, line], promos);
  const total = round2(after.subtotal - before.subtotal);
  const extras = line.extras?.reduce((sum, e) => sum + e.price, 0) ?? 0;
  const full = round2((itemSalePrice(line.price, line.discountPct) + extras) * line.qty);
  const applied = total < full;
  const hint = after.hints.find(h => h.itemId === line.itemId) ?? null;
  const promoName =
    after.promoSavings[line.itemId]?.promoName ??
    hint?.promoName ??
    promos.find(p => p.itemIds.includes(line.itemId))?.name ??
    null;
  return {
    total,
    full,
    applied,
    promoName,
    step: !applied && hint ? { addQty: hint.addQty, save: hint.save } : null,
  };
}
