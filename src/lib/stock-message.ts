/**
 * What to say when there was not enough of something.
 *
 * The refusal already knows the answer — `reserve_stock` returns how many are
 * actually left — and every screen threw it away and said only "ya no queda".
 * Somebody at the counter with a customer in front of them then has to guess,
 * or go and look. Telling them the number turns a dead end into a sentence
 * they can say out loud: "only four left, shall we make it four?"
 *
 * Zero is its own sentence: "none left" is not "0 left", and a dish that has
 * gone entirely is a different conversation from one that is short.
 */
export interface Short {
  name: string;
  /** How many the kitchen can actually supply right now. */
  available: number;
}

/** The phrase for one dish: its name, and what is left of it. */
export function shortText(
  s: Short,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  return s.available > 0
    ? t("pos.shortSome", { name: s.name, n: s.available })
    : t("pos.shortNone", { name: s.name });
}

/** The whole refusal, one dish or several. */
export function shortMessage(
  short: Short[],
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (short.length === 0) return t("pos.outOfStock", { names: "" });
  return t("pos.shortIntro", { list: short.map(s => shortText(s, t)).join("; ") });
}
