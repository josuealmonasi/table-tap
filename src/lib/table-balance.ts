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
 * Everything here is pure. What the table ordered and what has been collected
 * are read elsewhere; this only subtracts.
 */

/** An order on the table. `total` includes its tip, the way it does everywhere. */
export interface Owing {
  total: number;
  tip?: number;
}

/** A payment already taken, and how much of it was a gratuity. */
export interface Collected {
  amount: number;
  tip: number;
}

/**
 * The food an order came to, with the gratuity taken back out.
 *
 * A tip is added to `total` as it is collected — that convention is older than
 * this file and the takings depend on it. So a bill settled in parts has to
 * subtract it again, or the food owed would grow by every tip and the table
 * could never reach zero.
 */
export function foodOf(order: Owing): number {
  return round2(Number(order.total || 0) - Number(order.tip || 0));
}

/** What the table ordered, before anybody paid anything. */
export function foodOrdered(orders: Owing[]): number {
  return round2(orders.reduce((sum, o) => sum + foodOf(o), 0));
}

/** The food covered so far. A tip never counts towards it. */
export function foodCollected(collected: Collected[]): number {
  return round2(
    collected.reduce((sum, p) => sum + (Number(p.amount || 0) - Number(p.tip || 0)), 0),
  );
}

/**
 * The FOOD still owed. A tip never moves it.
 *
 * That is the whole reason a payment records its own tip: MX$115 handed over
 * against a MX$200 bill covers MX$100 of food, and a balance that could not
 * tell would say the table owes MX$85 when it owes MX$100 — and would close
 * the bill early, which is the expensive direction to be wrong in.
 */
export function stillOwed(orders: Owing[], collected: Collected[]): number {
  return Math.max(0, round2(foodOrdered(orders) - foodCollected(collected)));
}

/** Nothing left to collect, to the centavo. */
export function isSettled(orders: Owing[], collected: Collected[]): boolean {
  return stillOwed(orders, collected) < 0.005;
}

/**
 * What this payment may actually take.
 *
 * Never more food than is owed — a waiter mistyping 1000 for 100 must not
 * create a bill that owes minus MX$900 — and never less than nothing. The tip
 * is the diner's own and is not capped by the food: somebody settling the last
 * MX$20 of a bill may leave MX$50 if they want to.
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
