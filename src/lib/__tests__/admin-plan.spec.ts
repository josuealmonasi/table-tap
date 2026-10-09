import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const logged: { detail?: string | null; actor: string }[] = [];
vi.mock("@/lib/activity-log", () => ({ logEvent: async (e: { detail?: string | null; actor: string }) => void logged.push(e) }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));

import { moveRestaurantPlan } from "@/lib/admin-plan";

const PLANS = ["carta", "caja", "servicio", "casa", "grupo"];
let restaurant: Record<string, unknown>;

function fakeDb() {
  return {
    from(table: string) {
      const where: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => ((where[k] = v), q),
        update: (p: Record<string, unknown>) => ((patch = p), q),
        maybeSingle: async () => {
          if (table === "plan_limits") return { data: PLANS.includes(where.plan as string) ? { plan: where.plan } : null };
          return { data: restaurant.id === where.id ? { ...restaurant } : null };
        },
        then: (resolve: (v: unknown) => void) => {
          if (patch && restaurant.id === where.id) Object.assign(restaurant, patch);
          resolve({ error: null });
        },
      };
      return q;
    },
  } as never;
}
const stripeWith = (status: string | Error) =>
  ({ subscriptions: { retrieve: async () => (status instanceof Error ? Promise.reject(status) : { status }) } }) as unknown as Stripe;

beforeEach(() => {
  logged.length = 0;
  restaurant = { id: "r1", plan: "carta", plan_status: "trialing", trial_ends_at: "2026-11-01", plan_ends_at: null, stripe_subscription_id: null };
});

describe("a platform admin moves a restaurant to another plan", () => {
  it("moves it, active, with the trial cleared, and writes it in the restaurant's log", async () => {
    const answer = await moveRestaurantPlan(fakeDb(), "r1", "servicio", "admin@x.dev", stripeWith("canceled"));
    expect(answer).toEqual({ ok: true, from: "carta", to: "servicio" });
    expect(restaurant).toMatchObject({ plan: "servicio", plan_status: "active", trial_ends_at: null, plan_ends_at: null });
    expect(logged).toEqual([expect.objectContaining({ actor: "admin@x.dev", detail: "plan=carta→servicio by=platform_admin" })]);
  });

  it("refuses a plan that does not exist", async () => {
    expect(await moveRestaurantPlan(fakeDb(), "r1", "platinum", "a", stripeWith("canceled"))).toMatchObject({ status: 400 });
    expect(restaurant.plan).toBe("carta");
  });

  it("refuses a restaurant still billed by a live Stripe subscription, which would put the old plan back", async () => {
    for (const status of ["active", "trialing", "past_due"]) {
      restaurant.stripe_subscription_id = "sub_1";
      expect(await moveRestaurantPlan(fakeDb(), "r1", "casa", "a", stripeWith(status))).toMatchObject({ error: "apiErr.planHasSubscription" });
    }
    expect(restaurant.plan).toBe("carta");
  });

  it("refuses when Stripe cannot say, rather than guess the restaurant is not billed", async () => {
    restaurant.stripe_subscription_id = "sub_1";
    expect(await moveRestaurantPlan(fakeDb(), "r1", "casa", "a", stripeWith(new Error("network")))).toMatchObject({ status: 409 });
  });

  it("moves one whose subscription has ended or no longer exists", async () => {
    restaurant.stripe_subscription_id = "sub_old";
    expect(await moveRestaurantPlan(fakeDb(), "r1", "casa", "a", stripeWith("canceled"))).toMatchObject({ ok: true });
    restaurant.stripe_subscription_id = "sub_gone";
    const gone = Object.assign(new Error("no such subscription"), { code: "resource_missing" });
    expect(await moveRestaurantPlan(fakeDb(), "r1", "grupo", "a", stripeWith(gone))).toMatchObject({ ok: true, to: "grupo" });
  });
});
