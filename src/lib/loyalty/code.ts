// ============================================================================
// The code on a loyalty card.
//
// Twelve Crockford base32 characters: 60 random bits, printed in three groups
// of four and carried by the card's QR. The alphabet has no I, L, O or U, so a
// diner typing it off a photo cannot confuse a 1 with an I or a 0 with an O —
// and if they do, `normalizeCode` reads it the way they meant.
//
// `loyalty_cards.code` holds the same rule as a check constraint, and
// `code.spec.ts` compares the two, because a code the app makes and the
// database refuses is a card nobody can create.
// ============================================================================

export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 12;

/** A new card code. Random from the platform, never from Math.random. */
export function newCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  // 256 is a multiple of 32, so masking keeps every character equally likely.
  return Array.from(bytes, b => CODE_ALPHABET[b & 31]).join("");
}

/**
 * What somebody typed or scanned, as a stored code — or null.
 *
 * Case, spaces and dashes do not matter, and the letters the alphabet leaves
 * out are read as the digits they look like.
 */
export function normalizeCode(input: string): string | null {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** As printed on the card: K7QM-3XW9-TB4R. */
export function formatCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

/** Where the card's QR points: the diner's own progress. */
export function rewardsLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/rewards?c=${code}`;
}

/**
 * The code in whatever a camera read off a card.
 *
 * The QR carries the rewards link, so the diner can point their own camera at
 * their card; staff scanning it get the code out of the link. A code typed or
 * carried bare is read too, so an older or hand-made card still scans.
 */
export function codeFromScan(text: string): string | null {
  const trimmed = text.trim();
  try {
    const url = new URL(trimmed);
    const c = url.searchParams.get("c");
    return c ? normalizeCode(c) : null;
  } catch {
    return normalizeCode(trimmed);
  }
}
