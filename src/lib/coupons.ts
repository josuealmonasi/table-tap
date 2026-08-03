// Coupon code format. Everything about the shape of a code lives here, so
// changing it later (longer codes, a different grouping) is a one-file edit.

/** Groups of characters that make up a code, e.g. [3, 3] → "AB4-7KP". */
const GROUPS = [3, 3];
const SEPARATOR = "-";

/**
 * Characters a generated code can use. Deliberately excludes the pairs people
 * misread when a code is printed on a flyer or read aloud: 0/O and 1/I.
 * Typed codes are still matched against the full alphanumeric pattern, so a
 * customer who types "0" where we meant "O" simply gets "not found".
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** "XXX-XXX" — shown in the dashboard as a hint and used in validation copy. */
export const COUPON_PATTERN_HINT = GROUPS.map(n => "X".repeat(n)).join(SEPARATOR);

/** Matches a normalised code: alphanumeric groups only, nothing else. */
export const COUPON_PATTERN = new RegExp(
  `^${GROUPS.map(n => `[A-Z0-9]{${n}}`).join(SEPARATOR)}$`,
);

/** The total number of characters a customer types, ignoring separators. */
export const COUPON_LENGTH = GROUPS.reduce((sum, n) => sum + n, 0);

/**
 * Cleans up what a customer typed: upper-cases, drops surrounding whitespace,
 * and re-inserts the separators so "abc123" and "ABC-123" are the same code.
 * Any character outside [A-Z0-9] is stripped rather than rejected here — the
 * format check below decides whether the result is actually usable.
 */
export function normalizeCoupon(raw: string): string {
  const chars = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const parts: string[] = [];
  let at = 0;
  for (const size of GROUPS) {
    if (at >= chars.length) break;
    parts.push(chars.slice(at, at + size));
    at += size;
  }
  // Anything past the expected length is kept on the end so an over-long entry
  // fails the pattern check instead of being silently truncated to a valid code.
  if (at < chars.length) parts.push(chars.slice(at));
  return parts.join(SEPARATOR);
}

/** True when a normalised code has the right shape. */
export function isValidCouponFormat(code: string): boolean {
  return COUPON_PATTERN.test(code);
}

/** A random code in the current format, for the "generate" button. */
export function generateCouponCode(): string {
  return GROUPS.map(size =>
    Array.from(
      { length: size },
      () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
    ).join(""),
  ).join(SEPARATOR);
}
