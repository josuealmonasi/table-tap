import { beforeEach, describe, expect, it, vi } from "vitest";

const logged: { detail?: string | null }[] = [];
const mails: { to: string; text: string; idempotencyKey?: string }[] = [];
const applied: unknown[] = [];
let live: Record<string, unknown>[] = [];
let sessions: { id: string }[] = [];
const expired: string[] = [];
let restaurant: Record<string, unknown>;

vi.mock("@/lib/activity-log", () => ({ logEvent: async (e: { detail?: string | null }) => void logged.push(e) }));
vi.mock("@/lib/public-menu-cache", () => ({ invalidatePublicMenu: () => {} }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/mail", () => ({ sendMail: async (m: { to: string; text: string }) => (mails.push(m), { sent: true }) }));
vi.mock("@/lib/billing-operation", () => ({
  BillingError: class BillingError extends Error { constructor(public key: string, public status = 409) { super(key); } },
  withRestaurantBilling: async (_db: unknown, _id: string, action: (op: unknown) => unknown) =>
    await action({ token: "tok", record: async () => {}, write: async (f: () => unknown) => await f() }),
}));
vi.mock("@/lib/billing-state", () => ({
  restaurantBilling: async () => ({ live, sessions, exists: true, snapshot: {} }),
}));
vi.mock("@/lib/billing-price", () => ({
  BILLING_CURRENCY: "mxn",
  checkoutPrice: async (limits: { plan: string }) => ({ price: `price_${limits.plan}`, quantity: 1 }),
}));
vi.mock("@/lib/subscription-price", () => ({
  subscriptionPlan: async (s: { items: { data: { price: { id: string } }[] } }) => s.items.data[0].price.id.replace("price_", ""),
}));
vi.mock("@/lib/subscription-sync", () => ({ applySubscription: async (s: unknown) => void applied.push(s) }));
vi.mock("@/lib/plan-server", () => ({
  foundersTaken: async () => 3,
  allPlans: async () => ["carta", "caja", "servicio", "casa", "grupo"].map(plan => ({ plan, monthly_price: 999 })),
}));
vi.mock("@/lib/admin-plan", () => ({
  moveRestaurantPlan: async () => ({ ok: true, from: "carta", to: "casa" }),
}));

import { assignTier, payByDate, tierMail, assignedPayLink } from "@/lib/admin-tier";

function fakeDb() {
  return {
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "owner@x.dev" } } }) } },
    from() {
      const where: Record<string, unknown> = {};
      const nulls: [string, boolean][] = [];
      let patch: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => ((where[k] = v), q),
        is: (k: string) => (nulls.push([k, true]), q),
        not: (k: string) => (nulls.push([k, false]), q),
        update: (p: Record<string, unknown>) => ((patch = p), q),
        maybeSingle: async () => ({ data: { ...restaurant } }),
        then: (resolve: (v: unknown) => void) => {
          const hit = patch && Object.entries(where).every(([k, v]) => restaurant[k] === v)
            && nulls.every(([k, isNull]) => (restaurant[k] == null) === isNull);
          if (hit) Object.assign(restaurant, patch);
          resolve({ data: hit ? [{ id: restaurant.id }] : [], error: null });
        },
      };
      return q;
    },
  } as never;
}

const updates: { id: string; params: Record<string, unknown> }[] = [];
const fakeStripe = {
  checkout: { sessions: { expire: async (id: string) => { expired.push(id); return { id }; } } },
  subscriptions: {
    update: async (id: string, params: Record<string, unknown>) => {
      updates.push({ id, params });
      return { id, status: "active" };
    },
  },
} as never;

const subscription = (plan: string, status = "active", extra: Record<string, unknown> = {}, interval = "month") => ({
  id: "sub_1", status, metadata: { restaurant_id: "r1" }, cancel_at_period_end: false, cancel_at: null, ...extra,
  items: { data: [{ id: "si_1", price: { id: `price_${plan}`, currency: "mxn", recurring: { interval, interval_count: 1 } } }] },
});

const base = { restaurantId: "r1", origin: "https://tabletap.shop" };

beforeEach(() => {
  logged.length = 0; mails.length = 0; applied.length = 0; updates.length = 0; expired.length = 0;
  live = []; sessions = [];
  restaurant = { id: "r1", name: "Demo Bistro", plan: "carta", owner_id: "u1", subscription_sync_revision: 4, stripe_subscription_id: null };
});

describe("a platform admin assigns a tier to a restaurant that pays through Stripe", () => {
  it("moves the subscription to the new price from the next bill, with no proration", async () => {
    live = [subscription("caja")];
    const answer = await assignTier(fakeDb(), { ...base, plan: "casa", billing: "next_bill" }, "admin@x.dev", fakeStripe);
    expect(answer).toEqual({ ok: true, from: "caja", to: "casa", billing: "next_bill" });
    expect(updates).toEqual([{ id: "sub_1", params: expect.objectContaining({
      items: [{ id: "si_1", price: "price_casa", quantity: 1 }],
      proration_behavior: "none",
      metadata: { restaurant_id: "r1", plan: "casa" },
    }) }]);
    // The tier follows the Price at once, the way the webhook would write it.
    expect(applied).toHaveLength(1);
    expect(logged[0].detail).toContain("billing=next_bill");
  });

  it("changes nothing in Stripe when the subscription is already on that tier", async () => {
    live = [subscription("casa")];
    const answer = await assignTier(fakeDb(), { ...base, plan: "casa", billing: "next_bill" }, "admin@x.dev", fakeStripe);
    expect(answer).toMatchObject({ ok: true });
    expect(updates).toEqual([]);
  });

  it("refuses an overdue subscription: unpaid time is settled before the price moves", async () => {
    live = [subscription("caja", "past_due")];
    const answer = await assignTier(fakeDb(), { ...base, plan: "casa", billing: "next_bill" }, "admin@x.dev", fakeStripe);
    expect(answer).toEqual({ ok: false, error: "apiErr.tierSettleFirst", status: 409 });
    expect(updates).toEqual([]);
  });

  it("refuses a subscription already set to end: there is no next bill to change (review finding 4)", async () => {
    live = [subscription("caja", "active", { cancel_at_period_end: true })];
    const answer = await assignTier(fakeDb(), { ...base, plan: "casa", billing: "next_bill" }, "admin@x.dev", fakeStripe);
    expect(answer).toEqual({ ok: false, error: "apiErr.tierCancelScheduled", status: 409 });
    expect(updates).toEqual([]);
  });

  it("refuses a non-monthly subscription: Stripe would charge today (review finding 5)", async () => {
    live = [subscription("caja", "active", {}, "year")];
    const answer = await assignTier(fakeDb(), { ...base, plan: "casa", billing: "next_bill" }, "admin@x.dev", fakeStripe);
    expect(answer).toEqual({ ok: false, error: "apiErr.tierIntervalUnsupported", status: 409 });
    expect(updates).toEqual([]);
  });

  it("refuses a next-bill move for a restaurant with no subscription", async () => {
    const answer = await assignTier(fakeDb(), { ...base, plan: "casa", billing: "next_bill" }, "admin@x.dev", fakeStripe);
    expect(answer).toEqual({ ok: false, error: "apiErr.tierNoSubscription", status: 409 });
  });
});

describe("a platform admin assigns a tier with a payment link", () => {
  it("gives the tier now until the pay-by date and emails the owner the link", async () => {
    const payBy = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const answer = await assignTier(fakeDb(), { ...base, plan: "grupo", billing: "payment_link", payBy }, "admin@x.dev", fakeStripe);
    expect(answer).toMatchObject({ ok: true, from: "carta", to: "grupo", billing: "payment_link", payBy, emailed: true });
    // Stored as the app's own trial, so whatever ends trials ends an unpaid one.
    expect(restaurant).toMatchObject({ plan: "grupo", plan_status: "trialing", trial_ends_at: payBy, subscription_sync_revision: 5 });
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe("owner@x.dev");
    // The link is bound to this assignment's id, stored on the restaurant.
    expect(restaurant.tier_assignment_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mails[0].text).toContain(assignedPayLink("https://tabletap.shop", "grupo", restaurant.tier_assignment_id as string));
    expect(logged[0].detail).toContain("billing=payment_link");
  });

  it("refuses when a subscription is live: that one moves from its next bill instead", async () => {
    live = [subscription("caja")];
    const answer = await assignTier(fakeDb(), { ...base, plan: "casa", billing: "payment_link" }, "admin@x.dev", fakeStripe);
    expect(answer).toEqual({ ok: false, error: "apiErr.planHasSubscription", status: 409 });
    expect(restaurant.plan).toBe("carta");
    expect(mails).toEqual([]);
  });

  it("closes an open Checkout for another tier before assigning (review finding 3)", async () => {
    sessions = [{ id: "cs_old_casa" }];
    const answer = await assignTier(fakeDb(), { ...base, plan: "grupo", billing: "payment_link" }, "admin@x.dev", fakeStripe);
    expect(answer).toMatchObject({ ok: true });
    expect(expired).toEqual(["cs_old_casa"]);
  });

  it("a free move closes open Checkout pages too, under the lock (review finding 3)", async () => {
    sessions = [{ id: "cs_pay_link" }];
    const answer = await assignTier(fakeDb(), { ...base, plan: "casa", billing: "free" }, "admin@x.dev", fakeStripe);
    expect(answer).toMatchObject({ ok: true, billing: "free" });
    expect(expired).toEqual(["cs_pay_link"]);
  });

  it("a test account is free and gives back its founding place", async () => {
    restaurant.founding_number = 7; restaurant.stripe_subscription_id = null;
    const answer = await assignTier(fakeDb(), { ...base, plan: "servicio", billing: "test" }, "admin@x.dev", fakeStripe);
    expect(answer).toMatchObject({ ok: true, billing: "test", seatReleased: true });
    expect(restaurant.founding_number).toBeNull();
  });

  it("a founder paid by a live subscription keeps its place, even marked as a test account", async () => {
    restaurant.founding_number = 2; restaurant.stripe_subscription_id = "sub_live";
    const answer = await assignTier(fakeDb(), { ...base, plan: "servicio", billing: "test" }, "admin@x.dev", fakeStripe);
    expect(answer).toMatchObject({ ok: true, seatReleased: false });
    expect(restaurant.founding_number).toBe(2);
  });

  it("a plain free move never touches the founding place", async () => {
    restaurant.founding_number = 4; restaurant.stripe_subscription_id = null;
    const answer = await assignTier(fakeDb(), { ...base, plan: "casa", billing: "free" }, "admin@x.dev", fakeStripe);
    expect(answer).toMatchObject({ ok: true, billing: "free", seatReleased: false });
    expect(restaurant.founding_number).toBe(4);
  });

  it("refuses Carta, which costs nothing", async () => {
    const answer = await assignTier(fakeDb(), { ...base, plan: "carta", billing: "payment_link" }, "admin@x.dev", fakeStripe);
    expect(answer).toEqual({ ok: false, error: "apiErr.tierCartaIsFree", status: 400 });
  });

  it("refuses a pay-by date in the past", async () => {
    const answer = await assignTier(fakeDb(), { ...base, plan: "casa", billing: "payment_link", payBy: "2020-01-01" }, "admin@x.dev", fakeStripe);
    expect(answer).toEqual({ ok: false, error: "apiErr.tierPayByInvalid", status: 400 });
    expect(restaurant.plan).toBe("carta");
  });
});

describe("the pay-by date and the owner's email", () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  it("defaults to a week, and accepts only the next two months", () => {
    expect(payByDate(undefined, now)).toBe("2026-11-24T12:00:00.000Z");
    expect(payByDate("2026-11-16", now)).toBeNull();
    expect(payByDate("2027-02-01", now)).toBeNull();
    expect(payByDate(42, now)).toBeNull();
    expect(payByDate("2026-12-01T23:59:00-06:00", now)).toBe("2026-12-02T05:59:00.000Z");
  });

  it("names the tier, the date and the link, in Spanish", () => {
    const mail = tierMail({ restaurant: "Demo <Bistro>", plan: "casa", payBy: "2026-12-02T05:59:00.000Z", link: "https://tabletap.shop/api/billing/assigned?plan=casa" });
    expect(mail.subject).toContain("Casa");
    expect(mail.text).toContain("1 de diciembre de 2026");
    expect(mail.text).toContain("https://tabletap.shop/api/billing/assigned?plan=casa");
    // A restaurant name is typed by a person: it never reaches the HTML raw.
    expect(mail.html).not.toContain("<Bistro>");
  });
});

it("the founding limit counts places held, so a given-back place is free again", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const fn = sql.split("create or replace function public.claim_founding_price(")[1]?.split("$$;")[0] ?? "";
  expect(fn).toContain("(select count(*) from restaurants where founding_number is not null) >= p_limit then return null");
  expect(fn).not.toContain("if v_next > p_limit");
  expect(fn.indexOf("pg_advisory_xact_lock")).toBeLessThan(fn.indexOf("select count(*)"));
});
