import type { Order } from "@/lib/types";

/**
 * A discount the floor applies to a bill that is already open.
 *
 * Some promotions have no code for the diner to type — "half price if you show
 * your membership" is settled at the table, by someone looking at the card.
 * The manager opens the bill, enters the restaurant's own code, and the amount
 * the diner is asked for goes down before they pay.
 *
 * A bill can be several orders (a table where everyone ordered on their own
 * phone), and each order carries its own stored total, so the discount has to
 * be spread across them rather than parked on one. Spread by size, so nobody's
 * share is discounted more than anyone else's, with the rounding landing on
 * the largest order where a cent is least noticeable.
 */

export interface DiscountShare {
  orderId: string;
  /** What comes off this order. */
  amount: number;
  /** What the order's total becomes. */
  total: number;
}

/**
 * Orders a staff discount may still touch.
 *
 * The same set the diner's own bill screen counts, and for the same reasons:
 * a `pending_payment` row is a cart halfway through Stripe rather than food
 * anybody owes for, and discounting one would take money off a bill that does
 * not exist — which is how a MX$3.50 promotion first came out as MX$734.80.
 */
export function discountableOrders(orders: Order[]): Order[] {
  return orders.filter(
    o =>
      !o.paid &&
      !o.written_off &&
      o.status !== "cancelled" &&
      o.status !== "pending_payment" &&
      !o.coupon_code,
  );
}

/** What the bill comes to before the discount. */
export function billTotal(orders: Order[]): number {
  return round2(orders.reduce((sum, o) => sum + Number(o.total), 0));
}

/**
 * Splits `amount` across the orders in proportion to what each is worth.
 *
 * Never takes more off an order than the order is worth, and never leaves a
 * total below zero: a bill can be reduced to nothing, but not past it.
 */
export function spreadDiscount(orders: Order[], amount: number): DiscountShare[] {
  const total = billTotal(orders);
  if (orders.length === 0 || amount <= 0 || total <= 0) {
    return orders.map(o => ({ orderId: o.id, amount: 0, total: round2(Number(o.total)) }));
  }

  const capped = Math.min(round2(amount), total);
  const shares = orders.map(o => {
    const own = Number(o.total);
    return {
      orderId: o.id,
      amount: round2((capped * own) / total),
      total: 0,
    };
  });

  // Rounding lands on the biggest order, so the shares add back to the amount.
  const drift = round2(capped - shares.reduce((sum, s) => sum + s.amount, 0));
  if (drift !== 0) {
    const biggest = shares.reduce((a, b) => (b.amount > a.amount ? b : a));
    biggest.amount = round2(biggest.amount + drift);
  }

  return shares.map((share, i) => {
    const own = Number(orders[i].total);
    const amount = Math.min(share.amount, own);
    return { orderId: share.orderId, amount, total: round2(own - amount) };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
