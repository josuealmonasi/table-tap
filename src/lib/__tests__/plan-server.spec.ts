import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A trial that ran out is ended the moment somebody asks for the plan. That
 * write races the Stripe webhook of an owner subscribing at the last minute,
 * and must lose to it: the owner paid in time.
 */

const LIMITS: Record<string, { plan: string }> = { carta: { plan: "carta" }, servicio: { plan: "servicio" }, casa: { plan: "casa" } };
let row: Record<string, unknown>;
// What lands on the row after it was read and before the trial is ended.
let meanwhile: (() => void) | null = null;

function fakeDb() {
  return {
    from(table: string) {
      const where: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => ((where[k] = v), q),
        update: (p: Record<string, unknown>) => ((patch = p), q),
        maybeSingle: async () => ({ data: { ...row, plan_limits: LIMITS[row.plan as string] }, error: null }),
        single: async () => ({ data: LIMITS[where.plan as string] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => {
          if (table === "restaurants" && patch) {
            meanwhile?.();
            meanwhile = null;
            const hit = Object.entries(where).every(([k, v]) => row[k] === v);
            if (hit) Object.assign(row, patch);
            resolve({ data: hit ? [{ id: row.id }] : [], error: null });
          } else resolve({ data: null, error: null });
        },
      };
      return q;
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeDb() }));

const { getPlan } = await import("@/lib/plan-server");

const PAST = "2026-01-01T00:00:00Z";

beforeEach(() => {
  meanwhile = null;
  row = {
    id: "r1", plan: "servicio", plan_status: "trialing", trial_ends_at: PAST, plan_ends_at: null,
    stripe_subscription_id: null, subscription_sync_revision: 4,
  };
});

describe("a trial that ran out", () => {
  it("drops to the free tier, and moves the sync revision on", async () => {
    const plan = await getPlan("r1");
    expect(plan).toMatchObject({ limits: { plan: "carta" }, status: "active", trialEndsAt: null });
    expect(row).toMatchObject({ plan: "carta", plan_status: "active", trial_ends_at: null, subscription_sync_revision: 5 });
  });

  it("loses to a subscription that landed while it was being ended, and says what the restaurant is on", async () => {
    // The owner subscribed at the last minute; Stripe's webhook wrote the plan
    // (in a Stripe trial of its own) between the read and the ending.
    meanwhile = () => Object.assign(row, {
      plan: "casa", plan_status: "trialing", trial_ends_at: null,
      stripe_subscription_id: "sub_new", subscription_sync_revision: 5,
    });
    const plan = await getPlan("r1");
    expect(row).toMatchObject({ plan: "casa", stripe_subscription_id: "sub_new", subscription_sync_revision: 5 });
    expect(plan).toMatchObject({ limits: { plan: "casa" }, status: "trialing" });
  });

  it("is never ended for a restaurant Stripe already bills", async () => {
    row.stripe_subscription_id = "sub_1";
    const plan = await getPlan("r1");
    expect(row.plan).toBe("servicio");
    expect(plan).toMatchObject({ limits: { plan: "servicio" } });
  });
});
