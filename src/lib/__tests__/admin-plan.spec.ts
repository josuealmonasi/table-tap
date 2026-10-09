import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const logged: { detail?: string | null; actor: string }[] = [];
vi.mock("@/lib/activity-log", () => ({ logEvent: async (e: { detail?: string | null; actor: string }) => void logged.push(e) }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));

import { moveRestaurantPlan } from "@/lib/admin-plan";

const PLANS = ["carta", "caja", "servicio", "casa", "grupo"];
let restaurant: Record<string, unknown>;
// Something that happens to the row after the move has read it and before it
// writes — a Stripe webhook, or another admin.
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
        maybeSingle: async () => {
          if (table === "plan_limits") return { data: PLANS.includes(where.plan as string) ? { plan: where.plan } : null };
          return { data: restaurant.id === where.id ? { ...restaurant } : null };
        },
        then: (resolve: (v: unknown) => void) => {
          if (patch) meanwhile?.();
          // An update lands only where every condition still holds, as in Postgres.
          const hit = patch && Object.entries(where).every(([k, v]) => restaurant[k] === v);
          if (hit) Object.assign(restaurant, patch);
          resolve({ data: hit ? [{ id: restaurant.id }] : [], error: null });
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
  meanwhile = null;
  restaurant = { id: "r1", plan: "carta", plan_status: "trialing", trial_ends_at: "2026-11-01", plan_ends_at: null, stripe_subscription_id: null, subscription_sync_revision: 0 };
});

describe("a platform admin moves a restaurant to another plan", () => {
  it("moves it, active, with the trial cleared, and writes it in the restaurant's log", async () => {
    const answer = await moveRestaurantPlan(fakeDb(), "r1", "servicio", "admin@x.dev", stripeWith("canceled"));
    expect(answer).toEqual({ ok: true, from: "carta", to: "servicio" });
    expect(restaurant).toMatchObject({ plan: "servicio", plan_status: "active", trial_ends_at: null, plan_ends_at: null });
    // Unlinked from any finished subscription, and the sync revision moved on,
    // so a late Stripe event for it cannot write over this move.
    expect(restaurant).toMatchObject({ stripe_subscription_id: null, subscription_sync_revision: 1 });
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

  it("refuses, and changes nothing, when Stripe linked a subscription while it was deciding", async () => {
    // The owner subscribes in the seconds between the move reading the
    // restaurant (no subscription) and writing it: the webhook links the new
    // subscription and moves the revision on. Writing anyway would unlink a
    // subscription the owner is paying for.
    meanwhile = () => Object.assign(restaurant, { plan: "servicio", stripe_subscription_id: "sub_new", subscription_sync_revision: 1 });
    const answer = await moveRestaurantPlan(fakeDb(), "r1", "casa", "a", stripeWith("canceled"));
    expect(answer).toMatchObject({ ok: false, status: 409, error: "apiErr.planChangedMeanwhile" });
    expect(restaurant).toMatchObject({ plan: "servicio", stripe_subscription_id: "sub_new", subscription_sync_revision: 1 });
    expect(logged).toEqual([]);
  });

  it("moves one whose subscription has ended or no longer exists", async () => {
    restaurant.stripe_subscription_id = "sub_old";
    expect(await moveRestaurantPlan(fakeDb(), "r1", "casa", "a", stripeWith("canceled"))).toMatchObject({ ok: true });
    restaurant.stripe_subscription_id = "sub_gone";
    const gone = Object.assign(new Error("no such subscription"), { code: "resource_missing" });
    expect(await moveRestaurantPlan(fakeDb(), "r1", "grupo", "a", stripeWith(gone))).toMatchObject({ ok: true, to: "grupo" });
  });
});
