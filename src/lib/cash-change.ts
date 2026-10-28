/**
 * The change to hand back for cash, and the notes a diner is likely to hand
 * over. Shown only: what the sale records is still the amount owed, never
 * what was handed over, so the corte and the ledger are untouched.
 *
 * Pure.
 */
import { round2 } from "@/lib/money";

/** The notes in circulation, smallest first. */
const NOTES: Record<string, number[]> = {
  MXN: [20, 50, 100, 200, 500, 1000],
  USD: [1, 5, 10, 20, 50, 100],
};

/** The round amounts above what is owed that a single note or a common sum makes, at most four. */
export function cashSuggestions(amount: number, currency: string): number[] {
  if (!(amount > 0)) return [];
  const notes = NOTES[currency.toUpperCase()] ?? NOTES.MXN;
  const above = new Set<number>();
  for (const note of notes) {
    const v = round2(Math.ceil(round2(amount) / note) * note);
    if (v > round2(amount)) above.add(v);
  }
  return [...above].sort((a, b) => a - b).slice(0, 4);
}

/** What to give back, or how much is still missing. */
export function changeFor(amount: number, received: number): { change: number; short: number } {
  const diff = round2(received - amount);
  return diff >= 0 ? { change: diff, short: 0 } : { change: 0, short: round2(-diff) };
}
