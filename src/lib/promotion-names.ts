import type { PromotionWithItems } from "@/lib/promotions";
import type { MenuItem } from "@/lib/types";

/**
 * The dishes a promotion bundles, as one line: "2× Taco + Agua".
 *
 * Each dish keeps its own quantity. They were looked up, the missing ones
 * dropped, and the quantities then read by position — so once a dish in a
 * deal had been deleted, every quantity after it shifted onto the wrong name.
 */
export function promotionItemNames(p: PromotionWithItems, products: MenuItem[]): string {
  return p.items
    .map(i => ({ product: products.find(x => x.id === i.item_id), qty: i.qty ?? 1 }))
    .filter((x): x is { product: MenuItem; qty: number } => Boolean(x.product))
    .map(({ product, qty }) => (qty > 1 ? `${qty}× ${product.name}` : product.name))
    .join(" + ");
}
