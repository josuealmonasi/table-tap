/**
 * Opening hours for a menu.
 *
 * A menu without a schedule is driven by its `active` switch alone, which is
 * how every menu behaved before this existed — so adding the feature changes
 * nothing until someone sets one up. Several menus may be open at once: a
 * lunch menu on a schedule and a drinks menu left manual both show.
 *
 * `active` outranks the schedule in one direction only. Switching a menu off
 * hides it whatever the hours say; switching it on lets the schedule decide.
 */

/** 0 = Sunday … 6 = Saturday, matching Date#getDay. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ScheduleRule {
  /** Which days this rule covers. Empty means the rule does nothing. */
  days: Weekday[];
  /** Open the whole day; `start`/`end` are ignored. */
  allDay: boolean;
  /** "HH:MM", 24-hour. Ignored when allDay. */
  start?: string;
  end?: string;
}

export interface MenuSchedule {
  /** Paused schedules are kept but stop deciding anything. */
  enabled: boolean;
  rules: ScheduleRule[];
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes since midnight, or null when the value isn't a valid "HH:MM". */
export function toMinutes(value: string | undefined): number | null {
  if (!value) return null;
  const m = HHMM.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** True when the schedule is usable — enabled, with at least one real rule. */
export function hasLiveSchedule(schedule: MenuSchedule | null | undefined): boolean {
  if (!schedule?.enabled) return false;
  return schedule.rules.some(r => r.days.length > 0);
}

/**
 * Is this rule open at `day` / `minutes`?
 *
 * A window whose end is at or before its start runs past midnight — "22:00 to
 * 02:00" is a late bar, not an empty range — so it opens on the listed day and
 * closes on the next.
 */
export function ruleCoversAt(rule: ScheduleRule, day: Weekday, minutes: number): boolean {
  if (rule.allDay) return rule.days.includes(day);

  const start = toMinutes(rule.start);
  const end = toMinutes(rule.end);
  if (start === null || end === null) return false;

  if (end > start) return rule.days.includes(day) && minutes >= start && minutes < end;

  // Overnight: still open before the closing time on the following day.
  const yesterday = ((day + 6) % 7) as Weekday;
  return (
    (rule.days.includes(day) && minutes >= start) ||
    (rule.days.includes(yesterday) && minutes < end)
  );
}

/** The restaurant-local weekday and minutes-since-midnight for an instant. */
export function localNow(at: Date, timeZone: string): { day: Weekday; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = Math.max(0, days.indexOf(get("weekday"))) as Weekday;
  // Intl renders midnight as "24" in some environments; normalise it to 0.
  const hour = Number(get("hour")) % 24;
  return { day, minutes: hour * 60 + Number(get("minute")) };
}

/**
 * Should customers see this menu right now?
 *
 * @param active   the menu's own switch — an off menu is always hidden
 * @param schedule its hours, if any
 */
export function isMenuOpen(
  active: boolean,
  schedule: MenuSchedule | null | undefined,
  at: Date,
  timeZone: string,
): boolean {
  if (!active) return false;
  if (!hasLiveSchedule(schedule)) return true;
  const { day, minutes } = localNow(at, timeZone);
  return schedule!.rules.some(r => r.days.length > 0 && ruleCoversAt(r, day, minutes));
}

/** Drops rules that could never match, so nothing meaningless is stored. */
export function cleanSchedule(schedule: MenuSchedule): MenuSchedule {
  const rules = schedule.rules
    .map(r => ({
      days: [...new Set(r.days)].filter(d => d >= 0 && d <= 6).sort() as Weekday[],
      allDay: Boolean(r.allDay),
      start: r.allDay ? undefined : r.start,
      end: r.allDay ? undefined : r.end,
    }))
    .filter(
      r =>
        r.days.length > 0 &&
        (r.allDay || (toMinutes(r.start) !== null && toMinutes(r.end) !== null)),
    );
  return { enabled: Boolean(schedule.enabled), rules };
}

/** Why this schedule can't be saved, or null when it's fine. */
export function scheduleError(schedule: MenuSchedule): string | null {
  if (schedule.rules.length === 0) return "apiErr.schedNoRules";
  for (const rule of schedule.rules) {
    if (rule.days.length === 0) return "apiErr.schedNoDays";
    if (rule.allDay) continue;
    if (toMinutes(rule.start) === null || toMinutes(rule.end) === null) {
      return "apiErr.schedBadTime";
    }
    if (rule.start === rule.end) return "apiErr.schedSameTime";
  }
  return null;
}

/**
 * One short line per rule, e.g. "Mon–Fri 12:00–17:00" or "Sat, Sun all day".
 *
 * Day names arrive translated rather than being built here, so the same
 * function serves both languages and the summary matches the rest of the row.
 * Runs of consecutive days collapse to a range, which is what makes
 * "Mon–Fri" readable instead of five abbreviations.
 */
export function summarizeSchedule(
  schedule: MenuSchedule,
  dayNames: string[],
  allDayLabel: string,
): string[] {
  return schedule.rules
    .filter(r => r.days.length > 0)
    .map(rule => {
      const days = [...new Set(rule.days)].sort((a, b) => a - b);
      const groups: Weekday[][] = [];
      for (const d of days) {
        const last = groups[groups.length - 1];
        if (last && d === last[last.length - 1] + 1) last.push(d);
        else groups.push([d]);
      }
      const label = groups
        .map(g =>
          g.length >= 3
            ? `${dayNames[g[0]]}–${dayNames[g[g.length - 1]]}`
            : g.map(d => dayNames[d]).join(", "),
        )
        .join(", ");
      const when = rule.allDay ? allDayLabel : `${rule.start}–${rule.end}`;
      return `${label} ${when}`;
    });
}
