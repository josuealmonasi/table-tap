/**
 * How many ways a table may divide its bill.
 *
 * Pure, and in a file of its own so the diner's phone can consult it: the rule
 * belongs to both sides, and the server half lives next to the secret key
 * (`table-guests.ts`), which a client component may not reach.
 */

/** The most a bill can be divided between, however many phones are counted.
 *  `bill_splits.shares` is checked against the same number in the database. */
export const MAX_SHARES = 20;

/**
 * The counts a table may choose from, given how many phones are there.
 *
 * Never more than the phones present — proposing a share for somebody who is
 * not at the table is proposing a share nobody will ever claim, and an
 * unclaimed share freezes the bill for everyone — and never fewer than two,
 * because one is not a division. An empty list means there is nobody to divide
 * it with and the offer should not be made at all.
 */
export function shareChoices(present: number): number[] {
  const top = Math.min(Math.max(present, 0), MAX_SHARES);
  if (top < 2) return [];
  return Array.from({ length: top - 1 }, (_, i) => i + 2);
}
