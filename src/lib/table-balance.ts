import { round2 } from "@/lib/money";
import { sharesFor } from "@/lib/split";

/**
 * What a table still owes, as the waiter settles it in parts.
 *
 * A running balance rather than frozen shares. `bill_splits` divides a bill
 * into equal pieces and locks them, which is what a table agreeing among
 * themselves needs; a waiter standing at the table needs the other thing —
 * somebody hands over MX$100, somebody else MX$50, and the question after each
 * is simply how much is left.
 *
 * The whole balance is one sentence: what the orders come to, minus what has
 * been paid against them. A gratuity is added to the order as it is collected,
 * the way settling a whole table already does, so it appears on both sides at
 * once and never moves the answer.
 *
 * The arithmetic that says otherwise is the arithmetic that loses money. An
 * earlier version of this counted the food by taking `tip` back off `total`,
 * which cancelled the tips it had just added — and also cancelled a tip a
 * diner had committed to when ordering and nobody had collected yet. A table
 * owing MX$94.07 read as MX$93.17, and closed ninety centavos light.
 *
 * Everything here is pure. What the table ordered and what has been collected
 * are read elsewhere; this only subtracts.
 */

/** An order on the table. `total` is everything owed for it, gratuity included. */
export interface Owing {
  total: number;
}

/** A payment already taken, and how much of it was a gratuity. */
export interface Collected {
  amount: number;
  /** Reference, for the takings. It is inside `amount` and never subtracted twice. */
  tip: number;
}

/** What the table's orders come to. */
export function billTotal(orders: Owing[]): number {
  return round2(orders.reduce((sum, o) => sum + Number(o.total || 0), 0));
}

/** What has been handed over against them. */
export function paidSoFar(collected: Collected[]): number {
  return round2(collected.reduce((sum, p) => sum + Number(p.amount || 0), 0));
}

/** Still owed, never less than nothing. */
export function stillOwed(orders: Owing[], collected: Collected[]): number {
  return Math.max(0, round2(billTotal(orders) - paidSoFar(collected)));
}

/** Nothing left to collect, to the centavo. */
export function isSettled(orders: Owing[], collected: Collected[]): boolean {
  return stillOwed(orders, collected) < 0.005;
}

/**
 * What this payment may actually take.
 *
 * Never more than is owed — a waiter mistyping 1000 for 100 must not create a
 * bill that owes minus MX$900 — and never less than nothing. The tip is not
 * capped by it: it is the diner's own, and somebody settling the last MX$20 of
 * a bill may leave MX$50 if they want to.
 */
export function applyPayment(
  owed: number,
  asked: number,
  tip: number,
): { food: number; tip: number; amount: number } {
  const safeTip = Number.isFinite(tip) ? Math.max(0, round2(tip)) : 0;
  const wanted = Number.isFinite(asked) ? Math.max(0, round2(asked)) : 0;
  const food = Math.min(wanted, Math.max(0, round2(owed)));
  return { food, tip: safeTip, amount: round2(food + safeTip) };
}

/**
 * Equal parts, suggested.
 *
 * The app's one way of dividing a bill, reused rather than reinvented:
 * `sharesFor` puts the odd centavo on the FIRST share, so MX$10 between three
 * is 3.34 / 3.33 / 3.33. A second convention here would mean the same table
 * splitting the same bill two ways got two different answers depending on who
 * did the arithmetic.
 *
 * A suggestion only. The waiter can take any amount; these are the numbers the
 * screen offers so nobody does long division at a table.
 */
export function suggestEqual(owed: number, people: number): number[] {
  return sharesFor(round2(owed), people);
}
