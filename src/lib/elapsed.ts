import { dateLocale } from "./format";
import { messagesFor, translate, type Locale } from "./i18n";

/**
 * How long ago something happened, or how long it has lasted, in units a
 * person reads at a glance: minutes for the first hour, hours and minutes for
 * the first day, days and hours for the first week, then the date.
 *
 * Every elapsed time on a screen goes through here. The orders board once
 * said "hace 1741 min" for a ticket left open since yesterday — the floor had
 * to divide by sixty to learn it was a day old — and the request chips and the
 * bills list each had their own, different, rounding. Pure.
 */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const DATE_AFTER_DAYS = 7;

/** Whole minutes from `since` to `now`; never negative, 0 for an unreadable time. */
export function elapsedMinutes(since: string | number, now: number): number {
  const start = typeof since === "number" ? since : new Date(since).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.floor((now - start) / 60_000));
}

/**
 * A length of time with no "ago": "12 min", "2 h 15 min", "1 d 5 h". The
 * smaller unit is left out when it is zero ("1 h", not "1 h 0 min").
 */
export function formatDuration(minutes: number, locale: Locale): string {
  const m = translator(locale);
  const total = Math.max(0, Math.floor(Number.isFinite(minutes) ? minutes : 0));
  if (total < 1) return m("elapsed.underMinute");
  if (total < MINUTES_PER_HOUR) return m("elapsed.minutes", { m: total });
  if (total < MINUTES_PER_DAY) {
    const h = Math.floor(total / MINUTES_PER_HOUR);
    const rest = total % MINUTES_PER_HOUR;
    return rest === 0 ? m("elapsed.hours", { h }) : m("elapsed.hoursMinutes", { h, m: rest });
  }
  const d = Math.floor(total / MINUTES_PER_DAY);
  const h = Math.floor((total % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  return h === 0 ? m("elapsed.days", { d }) : m("elapsed.daysHours", { d, h });
}

/**
 * When something happened, relative to `now`: "ahora", "hace 12 min",
 * "hace 2 h 15 min", "hace 1 d 5 h", and from a week on the date itself,
 * "el 3 nov" — in the restaurant's time zone when the caller knows it.
 */
export function formatAgo(since: string | number, now: number, locale: Locale, timeZone?: string): string {
  const m = translator(locale);
  const minutes = elapsedMinutes(since, now);
  if (minutes < 1) return m("elapsed.justNow");
  if (minutes < DATE_AFTER_DAYS * MINUTES_PER_DAY) {
    return m("elapsed.ago", { time: formatDuration(minutes, locale) });
  }
  const date = new Date(since).toLocaleDateString(dateLocale(locale), {
    day: "numeric",
    month: "short",
    ...(timeZone ? { timeZone } : {}),
  });
  return m("elapsed.on", { date });
}

function translator(locale: Locale) {
  const messages = messagesFor(locale);
  return (key: string, vars?: Record<string, string | number>) => translate(messages, key, vars);
}
