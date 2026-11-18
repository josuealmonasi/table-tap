/** A price increase needs 30 full days, not 30 calendar labels. */
export function priceChangeDate(value: unknown, now = Date.now()): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at) || at < now + 30 * 24 * 60 * 60 * 1000) return null;
  return new Date(at).toISOString();
}
