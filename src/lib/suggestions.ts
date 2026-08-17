import type { CartItem } from "@/hooks/useCart";
import type { MenuItem } from "@/lib/types";

/**
 * What else the table might want, offered once, just before they order.
 *
 * A waiter asks "anything to drink with that?" — this is that question. It
 * only earns its place if it is genuinely useful, so the rules are the ones a
 * waiter would use rather than "here are four more dishes":
 *
 *   - never something already in the cart;
 *   - prefer a course the order is missing, because somebody who has ordered
 *     two mains wants a drink, not a third main;
 *   - then what the restaurant marks popular, then what other diners rated
 *     well — in that order, since the kitchen knows its menu better than an
 *     average does;
 *   - nothing unavailable, and nothing hidden from the menu.
 *
 * Pure, so what the customer is offered can be reasoned about in a test rather
 * than watched on a screen.
 */

export interface SuggestionInput {
  cart: CartItem[];
  items: MenuItem[];
  /** id → { avg, count }, as the menu already loads it. */
  ratings?: Record<string, { avg: number; count: number }>;
  /** Categories a diner tends to add at the end, most wanted first. */
  extraCourses?: string[];
  limit?: number;
}

export function suggestItems({
  cart,
  items,
  ratings = {},
  limit = 3,
}: SuggestionInput): MenuItem[] {
  if (cart.length === 0) return [];

  const inCart = new Set(cart.map(line => line.itemId));
  const cartCategories = new Set(
    cart
      .map(line => items.find(i => i.id === line.itemId)?.category_id)
      .filter((id): id is string => Boolean(id)),
  );

  const candidates = items.filter(
    item => !item.is_addon && item.available && !inCart.has(item.id),
  );

  const score = (item: MenuItem): number => {
    // A course they haven't ordered from is worth more than another of what
    // they already have.
    const newCourse = item.category_id && !cartCategories.has(item.category_id) ? 100 : 0;
    const popular = item.popular ? 20 : 0;
    const rating = (ratings[item.id]?.avg ?? 0) * 2;
    return newCourse + popular + rating;
  };

  return [...candidates]
    .sort((a, b) => score(b) - score(a) || a.sort_order - b.sort_order)
    .slice(0, limit);
}
