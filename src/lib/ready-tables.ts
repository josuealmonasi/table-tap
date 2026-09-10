import type { Order } from "@/lib/types";
import { shortCode } from "@/lib/open-bills";

/**
 * Food that is cooked and still on the pass.
 *
 * The kitchen's job ends when a ticket reaches `ready`; the floor's begins.
 * Nothing told the floor. A waiter had to keep glancing at a board across the
 * room, which is exactly the thing the board was supposed to save them from,
 * and a plate sat under a lamp until somebody happened to look.
 *
 * Grouped by table, because a waiter walks to a table rather than to a ticket:
 * three dishes ready for table four is one trip, and three separate chips
 * would have them make it three times.
 *
 * Pure. What is ready comes from the board, which is already live.
 */

export interface ReadyTable {
  /** Stable across renders: the table, or the single order at the counter. */
  key: string;
  /** "4", or null for a counter order that belongs to nobody's table. */
  label: string | null;
  /** What a counter order is called on the diner's own screen. */
  code: string | null;
  /** What a walk-in gave at the counter, when they gave one. */
  customerName: string | null;
  /** Every order to carry out; handing them over closes all of them. */
  orderIds: string[];
  dishes: number;
  /** When the first of them was ready — the wait the diners are feeling. */
  since: string;
}

/** How many dishes a ticket is, so a chip can say what the trip is worth. */
function dishesIn(order: Order): number {
  return (order.items ?? []).reduce((sum, item) => sum + Number(item.qty ?? 1), 0);
}

/**
 * @param orders every live order the board holds
 */
export function readyToDeliver(orders: Order[]): ReadyTable[] {
  const tables = new Map<string, ReadyTable>();

  for (const order of orders) {
    if (order.status !== "ready") continue;
    // A counter order is its own trip: there is no table to group it with, and
    // whoever is standing at the till is waiting for that one bag.
    const key = order.table_id ?? `order:${order.id}`;
    const found = tables.get(key);
    if (found) {
      found.orderIds.push(order.id);
      found.dishes += dishesIn(order);
      if (order.created_at < found.since) found.since = order.created_at;
      continue;
    }
    tables.set(key, {
      key,
      label: order.table_label,
      code: order.table_id ? null : shortCode(order.id),
      customerName: order.customer_name ?? null,
      orderIds: [order.id],
      dishes: dishesIn(order),
      since: order.created_at,
    });
  }

  // Longest wait first: the plate going coldest is the one to carry now.
  return [...tables.values()].sort((a, b) => a.since.localeCompare(b.since));
}
