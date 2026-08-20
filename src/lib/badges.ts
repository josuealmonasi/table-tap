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
  /** Orders the kitchen or the floor still has to move along. */
  orders: number;
  /** Requests only a manager or owner can decide. */
  approvals: number;
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

  // Everybody who works a service sees what is still cooking or waiting to go
  // out. The platform admin does not work one.
  if (role !== "admin" && counts.orders > 0) {
    out["/dashboard/orders"] = counts.orders;
  }

  // Only the people who can answer them.
  if ((role === "owner" || role === "manager") && counts.approvals > 0) {
    out["/dashboard/bills"] = counts.approvals;
  }

  return out;
}
