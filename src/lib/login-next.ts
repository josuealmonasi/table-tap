/**
 * Where sign-in may send someone afterwards, besides the usual dashboard.
 *
 * Only the assigned-tier pay link (src/app/api/billing/assigned/route.ts): an
 * owner who opened that email signed out landed on the dashboard and lost the
 * checkout they were sent to pay (review 2026-11-17, finding 6). Anything else
 * is refused, so `?next=` can never point sign-in at another site or page.
 */
const ALLOWED = /^\/api\/billing\/assigned\?plan=[a-z]+&until=\d{4}-\d{2}-\d{2}$/;

export function safeLoginNext(value: unknown): string | null {
  return typeof value === "string" && ALLOWED.test(value) ? value : null;
}
