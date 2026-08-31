/** Long enough for a real request, short enough to stay readable on a ticket. */
export const NOTE_MAX = 150;

/**
 * A note trimmed to what the kitchen will actually print.
 *
 * The field caps typing, but that only binds the browser — a forged payload can
 * send anything, and an unbounded note produces a ticket nobody reads. Trimmed
 * rather than rejected: the order is still what the diner asked for.
 */
export function capNote(note: string | null | undefined): string | undefined {
  const text = (note ?? "").trim();
  return text ? text.slice(0, NOTE_MAX) : undefined;
}

/** A counter order's name is short by nature: it gets called across a room. */
export const NAME_MAX = 40;

/**
 * The name a walk-in gives, trimmed to something a cashier can call out.
 *
 * Newlines and runs of space collapse: this is read aloud and printed on a
 * slip, and "Ana   \n  María" is the same person as "Ana María".
 */
export function capName(name: string | null | undefined): string | undefined {
  const text = (name ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, NAME_MAX) : undefined;
}
