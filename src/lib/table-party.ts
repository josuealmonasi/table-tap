import { MAX_SHARES } from "@/lib/split-shares";

/**
 * How many people a table's bill can be divided between.
 *
 * Pure: the rule is consulted by the diner's screen and enforced by the route
 * that creates the proposal, and those two must not be able to disagree.
 *
 * The count is the devices that have ORDERED on this sitting, not the ones
 * that scanned the code. Nineteen people can be sitting there; if ten of them
 * ordered, ten is what there is to divide between. A share belongs to a device
 * that has to claim it, and an unclaimed share freezes the bill for everyone —
 * which is exactly what happened when one diner, alone, proposed twelve.
 */
export interface Ordered {
  /** The device that placed it; null for a waiter's order, or storage off. */
  diner: string | null;
}

/**
 * The number of parties eating on this sitting.
 *
 * Orders with no device behind them count as one between them rather than one
 * each: a waiter who typed four rounds into the POS is not four people, but
 * the table they typed them for is certainly somebody.
 */
export function diningOn(orders: Ordered[]): number {
  const devices = new Set<string>();
  let anonymous = false;
  for (const o of orders) {
    if (o.diner) devices.add(o.diner);
    else anonymous = true;
  }
  return devices.size + (anonymous ? 1 : 0);
}

/** The most ways this table may divide, given who has ordered. */
export function splitCeiling(orders: Ordered[]): number {
  return Math.min(diningOn(orders), MAX_SHARES);
}
