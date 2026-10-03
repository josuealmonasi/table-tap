import type { PromotionWithItems } from "@/lib/promotions";
import type { OrderLineItem } from "@/lib/types";
import { MAX_CART_LINES, MAX_CART_REFS, type CartRejection } from "@/lib/cart-limits";

/**
 * Every menu row a cart refers to: the dishes, their extras, and the
 * components of any bundle in it.
 *
 * Written once because it was written twice. `verifyCart` prices from the rows
 * it is given, so a caller that fetches only the dishes hands it a cart whose
 * extras look like they have vanished — and the till did exactly that, failing
 * every sale with an extra on it. The list of what to fetch belongs with the
 * function that consumes it.
 */
export function referencedItemIds(
  items: OrderLineItem[],
  promotions: PromotionWithItems[],
): string[] {
  const comboComponents = promotions
    .filter(p => items.some(i => i.comboId === p.id))
    .flatMap(p => p.items.map(i => i.item_id));
  return [
    ...new Set([
      ...items.flatMap(i => [i.itemId, ...(i.extras?.map(e => e.id) ?? [])]),
      ...comboComponents,
    ]),
  ];
}

/**
 * The menu rows a cart refers to, or why it is too big to look up.
 *
 * The size of a cart has to be judged BEFORE the rows are fetched, because the
 * fetch is the thing the size breaks. `verifyCart` caps the lines too, but it
 * runs on the rows — by then the query has already been sent, and a cart of
 * two hundred lines carrying ten extras each is two thousand ids in a URL.
 */
export function cartReferences(
  items: OrderLineItem[],
  promotions: PromotionWithItems[],
  // The diner's checkout passes a lower one: it turns every line into a Stripe
  // line item, and Stripe takes a hundred of those.
  maxLines: number = MAX_CART_LINES,
): { ok: true; ids: string[] } | { ok: false; rejection: CartRejection } {
  if (items.length > maxLines) {
    return { ok: false, rejection: { kind: "tooManyLines", limit: maxLines } };
  }
  const ids = referencedItemIds(items, promotions);
  if (ids.length > MAX_CART_REFS) {
    return { ok: false, rejection: { kind: "tooManyRefs", limit: MAX_CART_REFS } };
  }
  return { ok: true, ids };
}
