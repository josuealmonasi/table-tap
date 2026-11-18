// Pure: imported by the admin panel in the browser. Nothing here may reach the
// secret-key client (src/lib/admin-health.ts reads the counts on the server).

/** What can break silently on the platform, in one read for the admin panel. */
export interface PlatformHealth {
  /** The last recovery run the database scheduler recorded; null if none. */
  schedulerLastRun: string | null;
  /** Ticket emails that ended failed or unconfigured in the last 7 days. */
  failedTickets7d: number;
  /** Price-change notices still unsent after at least one failed attempt. */
  stuckPriceNotices: number;
  /** Restaurants that cannot take card payments (no Stripe account, or charges off). */
  noCards: number;
}

/** The scheduler runs every 5 minutes; 15 without a run is a problem worth showing. */
export function schedulerStale(lastRun: string | null, now = Date.now()): boolean {
  return !lastRun || now - Date.parse(lastRun) > 15 * 60_000;
}
