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
