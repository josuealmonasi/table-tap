// ============================================================================
// Today, by the restaurant's calendar — the day a stamp is dated by.
//
// `loyalty_stamp()` dates a visit with `now() at time zone` the restaurant's
// zone, and anything that asks "is this today's visit?" has to use the same
// calendar. A seed that used UTC instead took today's slot every evening after
// six in Mexico City.
// ============================================================================
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { localDayKey } from "@/lib/day-window";

export function localToday(timezone: string | null, now: Date = new Date()): string {
  return localDayKey(now, timezone || DEFAULT_TIME_ZONE);
}
