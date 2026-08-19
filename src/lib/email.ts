/**
 * Is this an address worth trying to send to?
 *
 * One definition, used by the field and by the endpoint. When the button and
 * the server disagree, the diner gets an enabled button that fails — which is
 * worse than a disabled one, because they have already walked away believing
 * the receipt is coming.
 *
 * Deliberately not RFC 5322: the full grammar accepts things no restaurant
 * will ever type and rejecting a real address is the costlier mistake. This
 * asks for the shape everyone actually has — something, an @, a domain with a
 * dot, and a sensible ending.
 */
const SHAPE = /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/;

export const EMAIL_MAX = 200;

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > EMAIL_MAX) return false;
  if (!SHAPE.test(trimmed)) return false;
  // A domain has to end in letters — "me@site.c" and "me@site.123" are typos,
  // not addresses.
  const tld = trimmed.slice(trimmed.lastIndexOf(".") + 1);
  return tld.length >= 2 && /^[a-z]+$/i.test(tld);
}

/** What we would actually send to: trimmed and lowercased. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
