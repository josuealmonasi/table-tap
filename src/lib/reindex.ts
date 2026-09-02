/**
 * Keeps state that is keyed by array position honest when the array shrinks.
 *
 * Anything remembered per row by its index — a half-typed value, an expanded
 * flag — is remembered against a position, not against the row. Remove a row
 * above it and every later row slides down one while the remembered keys stay
 * put, so what the person typed is suddenly attached to a different row.
 *
 * The alternative is a stable id on every row, which means changing what is
 * stored. This keeps the stored shape and moves the keys with the rows.
 */
export function reindexAfterRemoval<T>(
  byIndex: Record<number, T>,
  removed: number,
): Record<number, T> {
  const next: Record<number, T> = {};
  for (const [key, value] of Object.entries(byIndex)) {
    const i = Number(key);
    if (i === removed) continue; // the row it belonged to is gone
    next[i > removed ? i - 1 : i] = value;
  }
  return next;
}
