import { round2 } from "@/lib/money";

/**
 * Dividing a bill evenly, and who eats the odd cent.
 *
 * MX$10 between three people is MX$3.3333…, and a third of a peso does not
 * exist. Someone has to pay a cent more, and the fair answer is the person who
 * asked to split: they chose the arithmetic, so they carry its remainder.
 *
 * Everything here is pure. What a table owes, who has already paid and what
 * somebody ordered afterwards are all decided elsewhere; this only divides.
 */

/** What one person owes: their share, plus anything they ordered since. */
export interface Share {
  /** Their slice of the frozen amount. */
  share: number;
  /** Their own orders, placed after the table agreed. */
  own: number;
  /** What they actually pay. */
  total: number;
}

/**
 * Split an amount into `people` shares, in centavos, with the remainder on the
 * first — which is the person who proposed it.
 *
 * Works in centavos rather than pesos because 0.1 + 0.2 is not 0.3 in binary,
 * and a bill that does not add back up to itself is the one thing a table will
 * always notice.
 */
export function sharesFor(amount: number, people: number): number[] {
  if (!Number.isInteger(people) || people < 1) return [];
  if (!(amount > 0)) return Array.from({ length: people }, () => 0);

  const cents = Math.round(round2(amount) * 100);
  const base = Math.floor(cents / people);
  const extra = cents - base * people;

  return Array.from({ length: people }, (_, i) => ((i === 0 ? base + extra : base)) / 100);
}

/**
 * What each person owes once the table has agreed.
 *
 * The split freezes: `amount` is what was outstanding at that moment, divided
 * evenly and never revisited. Anything ordered afterwards belongs to whoever
 * ordered it — the table agreed to divide the meal they had eaten, not to buy
 * each other another round.
 */
export function splitTotals(
  amount: number,
  people: number,
  ownSince: number[] = [],
): Share[] {
  return sharesFor(amount, people).map((share, i) => {
    const own = round2(ownSince[i] ?? 0);
    return { share, own, total: round2(share + own) };
  });
}

/**
 * What is left to divide.
 *
 * Someone paying for their own dishes before the table decides to split is
 * ordinary — the person who has to leave early does it every night. Their money
 * is already in, so it is not divided again: the table splits what is still
 * owed, and nothing else.
 */
export function amountToSplit(owedNow: number, alreadyPaid: number): number {
  return round2(Math.max(0, round2(owedNow) - round2(alreadyPaid)));
}

/** Whether the shares still add up to the thing they came from. */
export function addsUp(amount: number, shares: number[]): boolean {
  const sum = shares.reduce((a, b) => Math.round(b * 100) + a, 0);
  return sum === Math.round(round2(amount) * 100);
}
