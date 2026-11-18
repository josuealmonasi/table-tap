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
import { schedulerStale, webhookBad } from "@/lib/admin-health-rules";

it("counts the platform's silent failures in one read", async () => {
  expect(await readPlatformHealth()).toEqual({ schedulerLastRun: "2026-11-18T13:55:00Z", failedTickets7d: 3, stuckPriceNotices: 1, noCards: 2,
    webhooks: [{ stream: "platform", lastOkAt: null, lastRefusedAt: null, lastRefusal: null }, { stream: "connect", lastOkAt: null, lastRefusedAt: null, lastRefusal: null }] });
});

it("calls the scheduler stale after 15 minutes without a run, or when it never ran", () => {
  const now = Date.parse("2026-11-18T14:00:00Z");
  expect(schedulerStale("2026-11-18T13:55:00Z", now)).toBe(false);
  expect(schedulerStale("2026-11-18T13:40:00Z", now)).toBe(true);
  expect(schedulerStale(null, now)).toBe(true);
});

it("flags a webhook endpoint that never accepted an event, or none for a week, but not for a refusal anyone can send", () => {
  const now = Date.parse("2026-11-18T14:00:00Z");
  const beat = (lastOkAt: string | null, lastRefusedAt: string | null = null) =>
    ({ stream: "connect" as const, lastOkAt, lastRefusedAt, lastRefusal: lastRefusedAt ? "bad_signature" as const : null });
  expect(webhookBad(beat(null), now)).toBe(true);
  expect(webhookBad(beat("2026-11-17T14:00:00Z"), now)).toBe(false);
  expect(webhookBad(beat("2026-11-10T13:00:00Z"), now)).toBe(true);
  expect(webhookBad(beat("2026-11-17T14:00:00Z", "2026-11-18T13:59:00Z"), now)).toBe(false);
});
