/**
 * Where an owner pays a tier the admin assigned with a pay-by date. Shared by
 * the email (with the site's origin in front) and the dashboard banner, so the
 * two can never send the owner to different places. Pure: safe in the browser.
 */
export function assignedPayPath(plan: string, assignmentId: string): string {
  return `/api/billing/assigned?plan=${encodeURIComponent(plan)}&a=${assignmentId}`;
}
