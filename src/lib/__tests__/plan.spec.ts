import { describe, expect, it } from "vitest";
import {
  can,
  cheapestWith,
  dashboardFrozen,
  hasRoom,
  nextPlan,
  orderFeeCents,
  planFor,
  remaining,
  trialDaysLeft,
  type PlanLimits,
} from "@/lib/plan";

/** The seeded catalog, trimmed to what these tests ask about. */
const CATALOG: PlanLimits[] = [
  {
    plan: "carta",
    rank: 0,
    monthly_price: 0,
    order_fee: 3,
    max_tables: 0,
    max_staff: 2,
    max_menus: 1,
    max_items: 30,
    allows_dine_in: false,
    allows_promotions: false,
    allows_coupons: false,
    allows_staff_discounts: false,
    analytics_days: 1,
    log_days: 1,
  },
  {
    plan: "servicio",
    rank: 1,
    monthly_price: 699,
    order_fee: 1.5,
    max_tables: 25,
    max_staff: 10,
    max_menus: 3,
    max_items: null,
    allows_dine_in: true,
    allows_promotions: true,
    allows_coupons: false,
    allows_staff_discounts: false,
    analytics_days: 30,
    log_days: 30,
  },
  {
    plan: "casa",
    rank: 2,
    monthly_price: 1499,
    order_fee: 0.75,
    max_tables: null,
    max_staff: null,
    max_menus: null,
    max_items: null,
    allows_dine_in: true,
    allows_promotions: true,
    allows_coupons: true,
    allows_staff_discounts: true,
    analytics_days: 365,
    log_days: 365,
  },
];

const carta = CATALOG[0];
const servicio = CATALOG[1];
const casa = CATALOG[2];

describe("what a tier includes", () => {
  it("keeps dine-in behind the paid tiers", () => {
    expect(can(carta, "dineIn")).toBe(false);
    expect(can(servicio, "dineIn")).toBe(true);
  });

  it("keeps coupons above the entry tier", () => {
    expect(can(servicio, "coupons")).toBe(false);
    expect(can(casa, "coupons")).toBe(true);
  });
});

describe("ceilings", () => {
  it("asks about the next one, not the current count", () => {
    // 25 tables on Servicio means the 26th is refused, not the 25th.
    expect(hasRoom(24, 25)).toBe(true);
    expect(hasRoom(25, 25)).toBe(false);
  });

  it("treats null as unlimited", () => {
    expect(hasRoom(9999, null)).toBe(true);
    expect(remaining(9999, null)).toBeNull();
  });

  it("never reports a negative remainder", () => {
    // A restaurant downgraded below what it already has keeps its rows; the
    // counter has to read 0, not -4.
    expect(remaining(14, 10)).toBe(0);
  });

  it("refuses the first table on a tier without dine-in", () => {
    expect(hasRoom(0, carta.max_tables)).toBe(false);
  });
});

describe("billing health", () => {
  it("freezes the dashboard only when locked", () => {
    expect(dashboardFrozen("trialing")).toBe(false);
    expect(dashboardFrozen("active")).toBe(false);
    // Past due is a conversation, not a shutdown.
    expect(dashboardFrozen("past_due")).toBe(false);
    expect(dashboardFrozen("locked")).toBe(true);
  });
});

describe("the platform's cut", () => {
  it("is the tier's flat fee on an ordinary order", () => {
    const table = 30_000; // MX$300
    expect(orderFeeCents(carta, table)).toBe(300);
    expect(orderFeeCents(servicio, table)).toBe(150);
    expect(orderFeeCents(casa, table)).toBe(75);
  });

  it("never takes more than a tenth of a small order", () => {
    // MX$3 off a MX$20 coffee is a share of the coffee, not a fee.
    expect(orderFeeCents(carta, 2000)).toBe(200);
    expect(orderFeeCents(carta, 500)).toBe(50);
  });

  it("is capped on the food, so a tip can't raise what we take", () => {
    // A MX$5 coffee with a MX$20 tip is still a MX$5 order. Passing the
    // amount charged instead of the food is what let the cap drift.
    const food = 500;
    const withTip = 2500;
    expect(orderFeeCents(carta, food)).toBe(50);
    expect(orderFeeCents(carta, withTip)).toBe(250);
  });

  it("charges nothing when the tier includes it, or when there is nothing to charge", () => {
    expect(orderFeeCents({ ...casa, order_fee: 0 }, 30_000)).toBe(0);
    expect(orderFeeCents(casa, 0)).toBe(0);
    expect(orderFeeCents(casa, -100)).toBe(0);
  });
});

describe("trial countdown", () => {
  const now = new Date("2026-08-17T12:00:00Z");

  it("rounds part-days up, because a trial with hours left is still a trial", () => {
    expect(trialDaysLeft("2026-08-17T16:00:00Z", now)).toBe(1);
    expect(trialDaysLeft("2026-08-27T12:00:00Z", now)).toBe(10);
  });

  it("reads 0 once it has passed, and 0 when there was never one", () => {
    expect(trialDaysLeft("2026-08-16T12:00:00Z", now)).toBe(0);
    expect(trialDaysLeft(null, now)).toBe(0);
  });
});

describe("what to offer next", () => {
  it("points at the next tier up", () => {
    expect(nextPlan(CATALOG, "carta")?.plan).toBe("servicio");
    expect(nextPlan(CATALOG, "servicio")?.plan).toBe("casa");
  });

  it("has nothing to offer at the top", () => {
    expect(nextPlan(CATALOG, "casa")).toBeUndefined();
  });

  it("names the cheapest tier that unlocks a feature", () => {
    // A lock should say "coupons come with Casa", not "upgrade".
    expect(cheapestWith(CATALOG, "coupons")?.plan).toBe("casa");
    expect(cheapestWith(CATALOG, "dineIn")?.plan).toBe("servicio");
  });

  it("finds a plan by name, and admits when it can't", () => {
    expect(planFor(CATALOG, "casa")).toBe(casa);
    expect(planFor(CATALOG, "grupo")).toBeUndefined();
  });
});
