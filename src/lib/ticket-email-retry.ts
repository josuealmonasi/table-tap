// ============================================================================
// What a ticket email's send attempt leaves on its outbox rows. A failure that
// may pass (429, 5xx, a dropped connection) waits 1 minute, then 10, then an
// hour before the next claim; the fourth failure, or any refusal that a retry
// cannot change, finishes the rows as failed with the reason. Released rows
// were all claimed again within seconds before, so a short provider outage
// spent every attempt (background review, finding 2).
// ============================================================================
import type { MailResult } from "@/lib/mail";

export const TICKET_EMAIL_MAX_ATTEMPTS = 4;
const BACKOFF_MS = [60_000, 600_000, 3_600_000];

export type TicketOutcome =
  | { outcome: "sent" | "unconfigured" | "no_email" }
  | { outcome: "failed"; retryable: boolean; reason: string };

/** The provider's answer as an outcome. A key the provider says was already
 * used for a different body means an email went out under it: sent. */
export function ticketOutcome(result: MailResult): TicketOutcome {
  if (result.sent) return { outcome: "sent" };
  if (result.reason === "unconfigured") return { outcome: "unconfigured" };
  if (result.code === "invalid_idempotent_request") {
    console.warn("ticket email key already used for another body: counted as sent");
    return { outcome: "sent" };
  }
  const reason = [result.status, result.code].filter(Boolean).join(" ") || "network";
  return { outcome: "failed", retryable: result.retryable !== false, reason };
}

/** The outbox update for a group after one attempt, given its rows' attempt count. */
export function outboxPatch(result: TicketOutcome, attempts: number, now = Date.now()): Record<string, unknown> {
  if (result.outcome === "failed" && result.retryable && attempts < TICKET_EMAIL_MAX_ATTEMPTS) {
    const wait = BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1];
    return { claimed_at: null, claim: null, next_attempt_at: new Date(now + wait).toISOString(),
      failure_reason: result.reason.slice(0, 300) };
  }
  const reason = result.outcome !== "failed" ? null
    : `${result.retryable ? "retries exhausted" : "refused"}: ${result.reason}`.slice(0, 300);
  return { finished_at: new Date(now).toISOString(), outcome: result.outcome, mail_body: null, failure_reason: reason };
}
