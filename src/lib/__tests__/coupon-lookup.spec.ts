import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanLimits } from "@/lib/plan";

/**
 * A coupon is looked up for a restaurant, and answered by what its tier
 * carries — not only by whether the row exists.
 *
 * Codes saved on Casa went on discounting at checkout and on the bill after a
 * move to Servicio or Carta, because only creating one asked the plan.
 */

/** What the coupons table answers, as `{ data, error }`. */
const answer: { data: unknown; error: { message: string } | null } = { data: null, error: null };
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        ilike: () => query,
        maybeSingle: async () => answer,
      };
      return query;
    },
  }),
}));

const tier = { limits: null as Partial<PlanLimits> | null };
vi.mock("@/lib/plan-server", () => ({
  getPlan: async () => (tier.limits ? { limits: tier.limits } : null),
}));

const { findCoupon } = await import("@/lib/coupon-service");

const CASA = { plan: "casa", allows_coupons: true, allows_staff_discounts: true } as Partial<PlanLimits>;
const SERVICIO = { plan: "servicio", allows_coupons: false, allows_staff_discounts: false } as Partial<PlanLimits>;
const coupon = (staffOnly = false) => ({
  id: "c1", code: "ABC-123", kind: "percent", value: 10, min_subtotal: 0, max_uses: null,
  uses_count: 0, active: true, starts_at: null, ends_at: null, staff_only: staffOnly,
});

beforeEach(() => {
  answer.data = null;
  answer.error = null;
  tier.limits = CASA;
});

describe("a coupon lookup", () => {
  it("finds a diner's code on a tier with coupons", async () => {
    answer.data = coupon();
    expect((await findCoupon("r1", "ABC-123"))?.id).toBe("c1");
  });

  it("does not find it on a tier without coupons, though the row is there", async () => {
    answer.data = coupon();
    tier.limits = SERVICIO;
    expect(await findCoupon("r1", "ABC-123")).toBeNull();
  });

  it("answers the floor's codes by staff discounts, on the same rule", async () => {
    answer.data = coupon(true);
    expect((await findCoupon("r1", "ABC-123"))?.id).toBe("c1");
    tier.limits = SERVICIO;
    expect(await findCoupon("r1", "ABC-123")).toBeNull();
  });

  it("throws when the read fails, rather than calling a real code unknown", async () => {
    answer.error = { message: "canceling statement due to statement timeout" };
    await expect(findCoupon("r1", "ABC-123")).rejects.toThrow(/could not look up the coupon/i);
  });

  it("finds nothing for a restaurant with no plan row", async () => {
    answer.data = coupon();
    tier.limits = null;
    expect(await findCoupon("r1", "ABC-123")).toBeNull();
  });
});
