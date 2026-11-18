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
  /** Each Stripe webhook endpoint's last accepted and last refused event. */
  webhooks: WebhookBeat[];
}

export interface WebhookBeat {
  stream: "platform" | "connect";
  lastOkAt: string | null;
  lastRefusedAt: string | null;
  lastRefusal: "no_secret" | "bad_signature" | null;
}

const WEBHOOK_QUIET_DAYS = 7;

/**
 * An endpoint needs a look when it has never accepted an event, or has
 * accepted none for a week: a missing or wrong secret, a deleted endpoint and
 * a stale URL all look like this. A refusal alone is not enough: anyone can
 * send one, so it is shown beside the time but never turns the tile red.
 */
export function webhookBad(beat: WebhookBeat, now = Date.now()): boolean {
  if (!beat.lastOkAt) return true;
  return now - Date.parse(beat.lastOkAt) > WEBHOOK_QUIET_DAYS * 86_400_000;
}

/** The scheduler runs every 5 minutes; 15 without a run is a problem worth showing. */
export function schedulerStale(lastRun: string | null, now = Date.now()): boolean {
  return !lastRun || now - Date.parse(lastRun) > 15 * 60_000;
}
