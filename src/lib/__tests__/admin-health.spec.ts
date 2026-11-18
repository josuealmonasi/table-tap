import { expect, it, vi } from "vitest";

const counts: Record<string, number> = { ticket_email_outbox: 3, plan_price_notices: 1, restaurants: 2 };
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const q: Record<string, unknown> = {};
  const self = () => q;
  Object.assign(q, { select: self, eq: self, order: self, limit: self, in: self, gte: self, is: self, gt: self, or: self,
    maybeSingle: async () => ({ data: { at: "2026-11-18T13:55:00Z" }, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ count: counts[table] ?? 0, error: null }) });
  return q;
} }) }));
import { readPlatformHealth } from "@/lib/admin-health";
import { schedulerStale } from "@/lib/admin-health-rules";

it("counts the platform's silent failures in one read", async () => {
  expect(await readPlatformHealth()).toEqual({ schedulerLastRun: "2026-11-18T13:55:00Z", failedTickets7d: 3, stuckPriceNotices: 1, noCards: 2 });
});

it("calls the scheduler stale after 15 minutes without a run, or when it never ran", () => {
  const now = Date.parse("2026-11-18T14:00:00Z");
  expect(schedulerStale("2026-11-18T13:55:00Z", now)).toBe(false);
  expect(schedulerStale("2026-11-18T13:40:00Z", now)).toBe(true);
  expect(schedulerStale(null, now)).toBe(true);
});
