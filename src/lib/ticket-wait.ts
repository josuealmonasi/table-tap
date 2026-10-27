/**
 * How long a ticket has been waiting, and whether that is too long.
 *
 * The restaurant sets two thresholds (Settings, "Kitchen times"): past the
 * first a ticket turns amber, past the second red. Shared by the settings
 * route, which stores them, and the board, which shows them, so the two can
 * never disagree about what "late" means.
 *
 * Pure.
 */
export const DEFAULT_TICKET_WARN_MINUTES = 10;
export const DEFAULT_TICKET_LATE_MINUTES = 20;
const MAX_MINUTES = 240;

export type WaitLevel = "ok" | "warn" | "late";

/** Whole minutes since the order was placed; never negative. */
export function minutesWaiting(createdAt: string, now: number): number {
  const placed = new Date(createdAt).getTime();
  if (!Number.isFinite(placed)) return 0;
  return Math.max(0, Math.floor((now - placed) / 60_000));
}

export function waitLevel(minutes: number, warn: number, late: number): WaitLevel {
  if (minutes >= late) return "late";
  if (minutes >= warn) return "warn";
  return "ok";
}

/**
 * The thresholds as the database accepts them: whole minutes from 1 to 240,
 * with "late" always after "warn". A fat-fingered pair comes back usable
 * rather than as a 500 from the column's check.
 */
export function clampTicketTimes(warn: unknown, late: unknown): { warn: number; late: number } {
  const w = Math.min(MAX_MINUTES - 1, Math.max(1, Math.floor(Number(warn) || DEFAULT_TICKET_WARN_MINUTES)));
  const l = Math.min(MAX_MINUTES, Math.max(w + 1, Math.floor(Number(late) || DEFAULT_TICKET_LATE_MINUTES)));
  return { warn: w, late: l };
}
