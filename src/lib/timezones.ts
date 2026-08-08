/**
 * The zones offered in Settings.
 *
 * Menu schedules are evaluated in the restaurant's own zone, so this has to be
 * a real IANA name — "12:00" means nothing without one. Mexico's zones lead the
 * list because that's where the app's restaurants are; the rest of the world
 * follows so nothing is unreachable. `Intl.supportedValuesOf` would give every
 * zone, but 400 options in a select is worse than a short list that covers the
 * actual users and a long tail underneath.
 */
export const MEXICO_ZONES = [
  "America/Mexico_City",
  "America/Cancun",
  "America/Merida",
  "America/Monterrey",
  "America/Chihuahua",
  "America/Mazatlan",
  "America/Tijuana",
  "America/Hermosillo",
] as const;

/** Every zone this runtime knows, Mexico first. Falls back when unsupported. */
export function listTimeZones(): string[] {
  const all =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [...MEXICO_ZONES];
  const rest = all.filter(
    z => !MEXICO_ZONES.includes(z as (typeof MEXICO_ZONES)[number]),
  );
  return [...MEXICO_ZONES, ...rest];
}

/** Does this runtime recognise the zone? Guards the settings write. */
export function isKnownTimeZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
