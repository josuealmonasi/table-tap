/**
 * Days as the restaurant counts them.
 *
 * A server has no business deciding when a restaurant's day starts. Hosted in
 * UTC, "today" for a Mexico City kitchen would begin at six the previous
 * evening — so the takings on the board would carry half of last night and
 * drop tonight's dinner service into tomorrow. Every day boundary used for
 * money is drawn here, in the restaurant's own zone.
 *
 * Pure and dependency-free: `Intl` already knows every zone's offset and its
 * daylight-saving rules, which is the part nobody should hand-roll.
 */

/** How far the zone is from UTC at that instant, in milliseconds. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string): number => Number(parts.find(p => p.type === type)?.value ?? 0);
  // Reading the zone's wall clock back as if it were UTC gives the offset.
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24, // some zones format midnight as 24
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant the restaurant's day containing `at` began. */
export function startOfLocalDay(at: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string): number => Number(parts.find(p => p.type === type)?.value ?? 0);
  const midnightAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"));

  // Two passes, because the offset to subtract is the one in force at the
  // answer, not at the guess — they differ on the days a zone changes over.
  const first = midnightAsUtc - zoneOffsetMs(new Date(midnightAsUtc), timeZone);
  return new Date(midnightAsUtc - zoneOffsetMs(new Date(first), timeZone));
}

/** The instant the restaurant's next day begins. */
export function startOfNextLocalDay(at: Date, timeZone: string): Date {
  // Half a day past this day's end lands inside the next one whatever the
  // clocks did, and snapping back gives that day's true midnight.
  const noonIsh = startOfLocalDay(at, timeZone).getTime() + 36 * 60 * 60 * 1000;
  return startOfLocalDay(new Date(noonIsh), timeZone);
}

/** `2026-08-18` for the restaurant's day an instant falls in — a bucket key. */
export function localDayKey(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** 0–23 on the restaurant's clock, for "when are we busy". */
export function localHour(at: Date, timeZone: string): number {
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).format(at);
  return Number(value) % 24;
}

/** Steps back whole restaurant-days, for "the last 7 days". */
export function subtractLocalDays(at: Date, days: number, timeZone: string): Date {
  let cursor = startOfLocalDay(at, timeZone);
  for (let i = 0; i < days; i++) {
    // Same trick in reverse: land inside the previous day, then snap.
    cursor = startOfLocalDay(new Date(cursor.getTime() - 12 * 60 * 60 * 1000), timeZone);
  }
  return cursor;
}

/** The first instant of the restaurant's current month. */
export function startOfLocalMonth(at: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const day = Number(parts.find(p => p.type === "day")?.value ?? 1);
  return subtractLocalDays(at, day - 1, timeZone);
}
