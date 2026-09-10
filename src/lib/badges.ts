import type { DashboardRole } from "@/lib/nav";

/**
 * What each section is waiting on, for the person looking at it.
 *
 * A badge is a claim that somebody has to do something. That makes what it
 * counts a question about the reader, not the restaurant: a waiter or a
 * cashier cannot approve anything, so an approvals count on their screen is a number they
 * can only ignore — and a badge people learn to ignore has taught them to
 * ignore all of them.
 *
 * So each role is counted only on what it can act on, and sections nobody
 * acts on carry nothing at all.
 */
export interface BadgeCounts {
  /** Tickets the kitchen has not finished: received and preparing. */
  cooking: number;
  /** Food on the pass, cooked, waiting for somebody to carry it out. */
  ready: number;
  /** Requests only a manager or owner can decide. */
  approvals: number;
}

/**
 * Which orders are this person's to move.
 *
 * The board's two jobs meet at `ready`: it is the end of the kitchen's and the
 * start of the floor's. Counting both for everybody told a waiter a number
 * they could do nothing about, and told the kitchen their own finished plate
 * was still outstanding — while the one thing the waiter actually had to do,
 * carry it out, was in neither number.
 */
function ordersFor(role: DashboardRole, counts: BadgeCounts): number {
  if (role === "kitchen") return counts.cooking;
  if (role === "waiter" || role === "cashier") return counts.ready;
  // Owner and manager cover either job, and on a quiet night do both.
  return counts.cooking + counts.ready;
}

export const BADGE_MAX = 99;

/** "7", or "+99" once the exact number stops being the point. */
export function badgeLabel(count: number): string {
  return count > BADGE_MAX ? `+${BADGE_MAX}` : String(count);
}

/** Which sections show a count for this role, and what that count is. */
export function badgesFor(
  role: DashboardRole,
  counts: BadgeCounts,
): Record<string, number> {
  const out: Record<string, number> = {};

  // Everybody who works a service sees their own half of the board. The
  // platform admin does not work one.
  const orders = role === "admin" ? 0 : ordersFor(role, counts);
  if (orders > 0) out["/dashboard/orders"] = orders;

  // Only the people who can answer them.
  if ((role === "owner" || role === "manager") && counts.approvals > 0) {
    out["/dashboard/bills"] = counts.approvals;
  }

  return out;
}
