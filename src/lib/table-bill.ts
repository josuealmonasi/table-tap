import type { Order, OrderLineItem } from "@/lib/types";

/**
 * What a dine-in table still owes.
 *
 * A bill is the unpaid orders on a table, whoever placed them — that is what a
 * bill is in a restaurant, and it is what the waiter settles. The app has no
 * diner accounts, so "mine" is decided by which order ids this phone has a
 * record of placing; everything else on the table is somebody else's.
 *
 * Pure, so the customer's bill screen, the waiter's modal and the tests all
 * agree on the arithmetic without any of them re-deriving it.
 */

/**
 * How far back a table's bill reaches.
 *
 * A bill has no natural end: an order nobody settled stays owed forever, so
 * the next party to sit down would find the last party's food on their bill —
 * and "pay everything" would charge them for it. Bounding it to the current
 * service is what makes a table safe for new diners without anyone having to
 * remember to clear it.
 *
 * Eight hours covers the longest sitting anyone has, and rolls rather than
 * resetting at midnight, so a table that orders at 23:50 still has its bill at
 * 00:20. Nothing older is lost: it stays on the manager's open bills, to be
 * settled or cancelled by a person rather than quietly forgotten.
 */
export const OPEN_BILL_HOURS = 8;

/** The oldest order a table's own bill still counts. */
export function billWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - OPEN_BILL_HOURS * 60 * 60 * 1000);
}

export interface BillSide {
  orders: Order[];
  /** Every line across those orders, for listing what is being paid for. */
  items: OrderLineItem[];
  total: number;
  /**
   * What promotions already took off — a code the floor applied, or one the
   * diner used when ordering. `total` is net of it.
   *
   * Carried because a bill whose lines add up to more than its total is a bill
   * nobody trusts: the diner needs to see where the difference went.
   */
  discount: number;
}

export interface TableBill {
  /** Placed from this phone. */
  mine: BillSide;
  /** Placed from other phones at the same table. */
  others: BillSide;
  /** Everything outstanding — what "pay the lot" settles. */
  total: number;
  /** Everything already taken off the table's bill. */
  discount: number;
  /** Nothing owed: no bill, and no reason to show a bill button. */
  settled: boolean;
}

/**
 * Orders still owed for.
 *
 * Cancelled ones were never served. Written-off ones were served and never
 * paid for, but the restaurant has already given up on them — showing either
 * on a bill would ask somebody to pay for food nobody is charging for.
 */
export function unpaidOrders(orders: Order[]): Order[] {
  return orders.filter(o => !o.paid && !o.written_off && o.status !== "cancelled");
}

function side(orders: Order[]): BillSide {
  return {
    orders,
    items: orders.flatMap(o => o.items ?? []),
    // Rounded once at the end: summing pre-rounded totals is what makes a bill
    // disagree with the sum of its parts by a cent.
    total: round2(orders.reduce((sum, o) => sum + Number(o.total), 0)),
    discount: round2(orders.reduce((sum, o) => sum + Number(o.discount ?? 0), 0)),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * @param orders   every order on the table (paid ones are filtered out here)
 * @param myOrderIds ids this phone placed, from its own local record
 */
export function tableBill(orders: Order[], myOrderIds: string[]): TableBill {
  const owed = unpaidOrders(orders);
  const mineSet = new Set(myOrderIds);
  const mine = side(owed.filter(o => mineSet.has(o.id)));
  const others = side(owed.filter(o => !mineSet.has(o.id)));
  return {
    mine,
    others,
    total: round2(mine.total + others.total),
    discount: round2(mine.discount + others.discount),
    settled: owed.length === 0,
  };
}

/**
 * Which orders a chosen payment covers.
 *
 * "Mine" is only offered when somebody else is also on the bill — with nothing
 * else outstanding, paying "mine" and paying "everything" are the same act, and
 * offering both invites the diner to wonder what the difference is.
 */
export function ordersToPay(bill: TableBill, scope: "all" | "mine"): Order[] {
  return scope === "mine" ? bill.mine.orders : [...bill.mine.orders, ...bill.others.orders];
}

/** Is there anything for this phone to choose between? */
export function canPayMineOnly(bill: TableBill): boolean {
  return bill.mine.orders.length > 0 && bill.others.orders.length > 0;
}

/** A table with money outstanding, for the floor's own view of who owes what. */
export interface OpenTable {
  tableId: string;
  tableLabel: string;
  total: number;
  orderCount: number;
  /** When the table's oldest unpaid order was placed — how long they've sat. */
  since: string;
}

/**
 * Which tables owe money right now, oldest debt first.
 *
 * The board answers "what is the kitchen cooking"; this answers "who hasn't
 * paid", which is a different question and the one a manager asks on a busy
 * floor. Oldest first because a table that has been sitting on an unpaid bill
 * the longest is the one most likely to walk.
 *
 * Orders with no table are excluded: those are fast-food QRs, which pay before
 * the kitchen ever sees them, so an unpaid one is a cart mid-Stripe, not a debt.
 */
export function openTables(orders: Order[]): OpenTable[] {
  const byTable = new Map<string, OpenTable>();

  for (const order of unpaidOrders(orders)) {
    if (!order.table_id) continue;
    const found = byTable.get(order.table_id);
    if (found) {
      found.total = round2(found.total + Number(order.total));
      found.orderCount += 1;
      if (order.created_at < found.since) found.since = order.created_at;
    } else {
      byTable.set(order.table_id, {
        tableId: order.table_id,
        tableLabel: order.table_label ?? "",
        total: round2(Number(order.total)),
        orderCount: 1,
        since: order.created_at,
      });
    }
  }

  return [...byTable.values()].sort((a, b) => a.since.localeCompare(b.since));
}
