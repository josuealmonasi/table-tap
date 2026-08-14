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

export interface BillSide {
  orders: Order[];
  /** Every line across those orders, for listing what is being paid for. */
  items: OrderLineItem[];
  total: number;
}

export interface TableBill {
  /** Placed from this phone. */
  mine: BillSide;
  /** Placed from other phones at the same table. */
  others: BillSide;
  /** Everything outstanding — what "pay the lot" settles. */
  total: number;
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
