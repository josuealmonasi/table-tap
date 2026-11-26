import { timingSafeEqual } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The shape `restaurant_tables.qr_key` is generated in: a UUID without dashes. */
export const QR_KEY = /^[0-9a-f]{32}$/;

/** One spelling per id, so a limiter keyed on it cannot be split by case. */
export function canonicalUuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

/**
 * Whether a waiting phone holds the key printed in this table's QR. A table
 * with no key predates printed keys: its sticker carries none and must keep
 * working until the table is renamed, which gives it one.
 */
export function qrKeyMatches(tableKey: string | null | undefined, given: unknown): boolean {
  if (!tableKey) return true;
  if (typeof given !== "string" || !QR_KEY.test(given) || given.length !== tableKey.length) return false;
  return timingSafeEqual(Buffer.from(tableKey), Buffer.from(given));
}
