import type { MenuItem, OrderLineItem } from "@/lib/types";
import type { CartItem } from "@/hooks/useCart";
import type { RememberedLine } from "@/lib/usual";

/**
 * What makes the till fast in a morning rush.
 *
 * Asked for by a café: "I'd judge this by how quickly a new employee can
 * serve a queue." So a dish with nothing to choose goes into the sale in one
 * tap, the products that actually sell are at the top, and the order before
 * can be rung again whole.
 *
 * Pure.
 */

/** How many best sellers the till puts at the top. */
export const TOP_SELLERS = 8;

/**
 * The line a single tap adds, or null when the dish has something to choose
 * — an option group or an extra — and so opens its screen instead.
 */
export function quickLine(item: MenuItem, extrasOffered: number): OrderLineItem | null {
  if ((item.modifiers?.length ?? 0) > 0 || extrasOffered > 0) return null;
  return {
    itemId: item.id,
    name: item.name,
    emoji: item.emoji,
    price: item.price,
    discountPct: item.discount_pct ?? 0,
    qty: 1,
    mods: {},
    extras: [],
  };
}

/** A line with nothing on it but the dish: one more tap is one more of it. */
const plain = (line: OrderLineItem) =>
  !line.components?.length &&
  !line.notes &&
  !(line.extras?.length) &&
  Object.keys(line.mods ?? {}).length === 0;

/** The plain line of this dish already in the sale, which a tap adds one to. */
export function plainTwin(lines: CartItem[], itemId: string): CartItem | undefined {
  return lines.find(l => l.itemId === itemId && plain(l));
}

/** How many of each dish the sale holds, for the tiles to say. */
export function inSale(lines: OrderLineItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (line.components?.length) continue;
    counts.set(line.itemId, (counts.get(line.itemId) ?? 0) + line.qty);
  }
  return counts;
}

/**
 * The dishes that sold most across recent orders, most first — only those
 * still on the menu and available, so the row never offers what cannot be
 * sold. Combos are counted by their own line, not their parts.
 */
export function topSellers(orders: { items: OrderLineItem[] | null }[], menu: MenuItem[], limit = TOP_SELLERS): string[] {
  const sellable = new Set(menu.filter(i => i.available && !i.is_addon).map(i => i.id));
  const counts = new Map<string, number>();
  for (const order of orders) {
    for (const line of order.items ?? []) {
      if (line.components?.length || !sellable.has(line.itemId)) continue;
      counts.set(line.itemId, (counts.get(line.itemId) ?? 0) + Number(line.qty || 1));
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

/** A sale as the till remembers it to ring again: what was chosen, by id. */
export function remember(lines: OrderLineItem[]): RememberedLine[] {
  return lines
    .filter(l => !l.components?.length)
    .map(l => ({
      itemId: l.itemId,
      qty: l.qty,
      mods: l.mods ?? {},
      extras: (l.extras ?? []).map(e => e.id),
      notes: l.notes,
    }));
}
