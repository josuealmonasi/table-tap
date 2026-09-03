import type { OrderLineItem } from "@/lib/types";

/** How many of one dish the kitchen can still serve. */
export interface StockLimit {
  itemId: string;
  available: number;
}

/** A cart line carries the id the cart uses to tell two identical lines apart. */
type CartLine = OrderLineItem & { cartId: number };

/**
 * Cuts a cart down to what the kitchen actually has.
 *
 * The checkout answers with what is left when it cannot fill an order, and
 * this is what turns that answer into a cart the customer can pay for: asking
 * for six when there are five leaves five, rather than sending them back to
 * hunt for the line themselves.
 *
 * Allocated front to back, so the line they added first is the one that keeps
 * its quantity. A line that ends up with nothing is dropped — asking someone
 * to pay for zero tacos is worse than removing the row.
 *
 * Only plain lines are trimmed. A combo eats from each of its components'
 * counts, so "one fewer" has no single meaning for it — those are left alone
 * and the customer is told which dish ran short instead. Extras are left for
 * the same reason: the line they hang off is the thing being bought.
 */
export function trimCartToStock(items: CartLine[], limits: StockLimit[]): CartLine[] {
  if (limits.length === 0) return items;
  const remaining = new Map(limits.map(l => [l.itemId, Math.max(0, l.available)]));

  const kept: CartLine[] = [];
  for (const line of items) {
    // A combo's own id is a promotion, never a counted dish.
    if (line.comboId || !remaining.has(line.itemId)) {
      kept.push(line);
      continue;
    }
    const left = remaining.get(line.itemId)!;
    const take = Math.min(line.qty, left);
    remaining.set(line.itemId, left - take);
    if (take > 0) kept.push({ ...line, qty: take });
  }
  return kept;
}

/** Whether trimming would actually change anything the customer can see. */
export function trimChangesCart(items: CartLine[], limits: StockLimit[]): boolean {
  const trimmed = trimCartToStock(items, limits);
  if (trimmed.length !== items.length) return true;
  return trimmed.some((line, i) => line.qty !== items[i].qty);
}
