import type { Order, OrderLineItem } from "@/lib/types";
import { unpaidOrders } from "@/lib/table-bill";
import { round2 } from "@/lib/money";

/**
 * A bill the floor can still act on: a table that hasn't settled, or a to-go
 * order that hasn't been paid for.
 *
 * Grouped the way the floor thinks about them — one row per table, because a
 * table is what a manager is asked about ("the four by the window want their
 * discount"), and one row per to-go order, because those have nobody sitting
 * anywhere. Oldest first: the longest wait is the one being asked about.
 */
export interface OpenBill {
  key: string;
  tableId: string | null;
  tableLabel: string | null;
  /** Short code shown for a to-go order, so it can be searched for. */
  code: string | null;
  /** What a walk-in gave at the counter, when they gave one. */
  customerName: string | null;
  orderIds: string[];
  items: OrderLineItem[];
  total: number;
  /** What promotions took off this bill; `total` already has it deducted. */
  discount: number;
  /** A promotion is already on it; a second would discount the same food twice. */
  discounted: boolean;
  since: string;
  /** A table part-way through dividing its bill, and how far it has got. */
  split?: { shares: number; paidShares: number } | null;
  /**
   * Money already handed over against the SITTING rather than any one order.
   *
   * A share of a divided bill, or a waiter collecting part of it at the table
   * — the same thing as far as this row is concerned, and the same danger:
   * every order still reads as unpaid until the bill closes, so without this
   * the floor sees the full amount owing on a table that has already paid half
   * of it, and settling it in cash would take that half twice.
   */
  collected?: number;
}

/**
 * Which sitting a bill belongs to, if its orders are on one.
 *
 * Kept separate from `openBills` so the grouping stays a pure function of the
 * orders, and these are the only places that know about sittings.
 */
function sessionOfBill(bill: OpenBill, sessionOf: Map<string, string>): string | undefined {
  return bill.orderIds.map(id => sessionOf.get(id)).find(Boolean);
}

/** How far a table has got through dividing its bill. */
export function withSplits(
  bills: OpenBill[],
  splits: { session_id: string; shares: number; paidShares: number }[],
  sessionOf: Map<string, string>,
): OpenBill[] {
  const bySession = new Map(splits.map(s => [s.session_id, s]));
  return bills.map(bill => {
    const found = bySession.get(sessionOfBill(bill, sessionOf) ?? "");
    return found
      ? { ...bill, split: { shares: found.shares, paidShares: found.paidShares } }
      : bill;
  });
}

/**
 * What has already been paid against each sitting.
 *
 * One number from one place — the ledger — however it was collected. Reading
 * the split's own claims instead would have shown a share of a divided bill
 * and missed a waiter's collection entirely, which is the half of the money
 * the floor most needs to know about: it is the half somebody could take
 * again.
 */
export function withCollected(
  bills: OpenBill[],
  collected: Map<string, number>,
  sessionOf: Map<string, string>,
): OpenBill[] {
  return bills.map(bill => {
    const paid = collected.get(sessionOfBill(bill, sessionOf) ?? "") ?? 0;
    return paid > 0 ? { ...bill, collected: round2(paid) } : bill;
  });
}

export function openBills(orders: Order[]): OpenBill[] {
  const bills = new Map<string, OpenBill>();

  for (const order of unpaidOrders(orders)) {
    // A table's orders are one bill; a to-go order is its own.
    const key = order.table_id ?? `order:${order.id}`;
    const found = bills.get(key);
    if (found) {
      found.orderIds.push(order.id);
      found.items.push(...(order.items ?? []));
      found.total = round2(found.total + Number(order.total));
      found.discount = round2(found.discount + Number(order.discount ?? 0));
      found.discounted = found.discounted || Boolean(order.coupon_code);
      if (order.created_at < found.since) found.since = order.created_at;
      continue;
    }
    bills.set(key, {
      key,
      tableId: order.table_id,
      tableLabel: order.table_label,
      code: order.table_id ? null : shortCode(order.id),
      customerName: order.customer_name ?? null,
      orderIds: [order.id],
      items: [...(order.items ?? [])],
      total: round2(Number(order.total)),
      discount: round2(Number(order.discount ?? 0)),
      discounted: Boolean(order.coupon_code),
      since: order.created_at,
    });
  }

  return [...bills.values()].sort((a, b) => a.since.localeCompare(b.since));
}

/** Matches a bill by table label or order code, however the staff type it. */
export function matchesBill(bill: OpenBill, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (bill.tableLabel ?? "").toLowerCase().includes(q) ||
    (bill.code ?? "").toLowerCase().includes(q) ||
    // A cashier looking for a walk-in searches the name they were given, not
    // the code the diner's phone shows.
    (bill.customerName ?? "").toLowerCase().includes(q) ||
    bill.items.some(i => i.name.toLowerCase().includes(q))
  );
}

/** The tail of an order id, as the customer's receipt shows it. */
export function shortCode(orderId: string): string {
  return `ORD-${orderId.slice(0, 4).toUpperCase()}`;
}

