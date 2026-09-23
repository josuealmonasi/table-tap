// ============================================================================
// Today, by the restaurant's calendar — the day a stamp is dated by.
//
// `loyalty_stamp()` dates a visit with `now() at time zone` the restaurant's
// zone, and anything that asks "is this today's visit?" has to use the same
// calendar. A seed that used UTC instead took today's slot every evening after
// six in Mexico City.
// ============================================================================
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";

export function localToday(timezone: string | null, now: Date = new Date()): string {
  // en-CA formats a date as YYYY-MM-DD, the shape `visit_day` is stored in.
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || DEFAULT_TIME_ZONE }).format(now);
}
