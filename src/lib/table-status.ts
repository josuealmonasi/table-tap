import { billWindowStart, unpaidOrders } from "@/lib/table-bill";
import type { Order } from "@/lib/types";

/**
 * Whether a table is free for the next party.
 *
 * There is no occupancy flag to keep in step — a table is taken exactly when
 * somebody sitting at it still owes for something, and free the moment that
 * stops being true. Everyone paying in full frees it; so does cancelling a
 * walkout, which is the same fact arrived at differently.
 *
 * Derived rather than stored, because a flag someone forgets to clear is worse
 * than no flag at all: it would show a table as taken all evening after the
 * party had left.
 */
export interface TableStatus {
  /** Nobody owes anything: safe to seat. */
  free: boolean;
  /** What is still outstanding, when it isn't. */
  owed: number;
  /** How many orders that covers. */
  orders: number;
}

export function tableStatuses(
  orders: Order[],
  now: Date = new Date(),
): Map<string, TableStatus> {
  const cutoff = billWindowStart(now).toISOString();
  const byTable = new Map<string, TableStatus>();

  for (const order of unpaidOrders(orders)) {
    // Same window the diner's bill uses: last night's forgotten ticket is the
    // manager's to resolve, not a reason to hold a table out of service.
    if (!order.table_id || order.created_at < cutoff) continue;
    const found = byTable.get(order.table_id) ?? { free: false, owed: 0, orders: 0 };
    found.owed = Math.round((found.owed + Number(order.total)) * 100) / 100;
    found.orders += 1;
    byTable.set(order.table_id, found);
  }

  return byTable;
}

/** A table nobody has ordered from is free. */
export function statusFor(
  statuses: Map<string, TableStatus>,
  tableId: string,
): TableStatus {
  return statuses.get(tableId) ?? { free: true, owed: 0, orders: 0 };
}
