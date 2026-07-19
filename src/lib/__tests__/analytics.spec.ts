import { describe, it, expect } from "vitest";
import {
  computeAnalytics,
  periodRange,
  normalisePeriod,
  type AnalyticsOrder,
} from "@/lib/analytics";
import type { OrderLineItem } from "@/lib/types";

function line(over: Partial<OrderLineItem> = {}): OrderLineItem {
  return {
    itemId: "i1",
    name: "Ramen",
    emoji: "🍜",
    price: 100,
    qty: 1,
    mods: {},
    ...over,
  };
}

function order(over: Partial<AnalyticsOrder> = {}): AnalyticsOrder {
  return {
    total: 100,
    tip: 0,
    created_at: new Date().toISOString(),
    items: [line()],
    ...over,
  };
}

describe("normalisePeriod", () => {
  it("passes through the known periods", () => {
    expect(normalisePeriod("7d")).toBe("7d");
    expect(normalisePeriod("30d")).toBe("30d");
    expect(normalisePeriod("month")).toBe("month");
    expect(normalisePeriod("today")).toBe("today");
  });

  it("falls back to 'today' for anything unknown", () => {
    expect(normalisePeriod(undefined)).toBe("today");
    expect(normalisePeriod("all-time")).toBe("today");
    expect(normalisePeriod("")).toBe("today");
  });
});

describe("periodRange", () => {
  const now = new Date("2026-07-18T15:30:00"); // a Saturday, local time

  it("'today' spans the current local day into tomorrow", () => {
    const { start, end } = periodRange("today", now);
    expect(start.getHours()).toBe(0);
    expect(start.getDate()).toBe(18);
    expect(end.getDate()).toBe(19);
    expect(end.getHours()).toBe(0);
  });

  it("'7d' starts six days back (7 days inclusive)", () => {
    const { start } = periodRange("7d", now);
    expect(start.getDate()).toBe(12);
  });

  it("'30d' starts 29 days back", () => {
    const { start } = periodRange("30d", now);
    // 29 days before Jul 18 is Jun 19.
    expect(start.getMonth()).toBe(5); // June (0-indexed)
    expect(start.getDate()).toBe(19);
  });

  it("'month' starts on the first of the current month", () => {
    const { start } = periodRange("month", now);
    expect(start.getDate()).toBe(1);
    expect(start.getMonth()).toBe(6); // July
  });
});

describe("computeAnalytics", () => {
  it("returns zeroed totals with no orders", () => {
    const a = computeAnalytics([], "today");
    expect(a.revenue).toBe(0);
    expect(a.orderCount).toBe(0);
    expect(a.avgTicket).toBe(0);
    expect(a.tips).toBe(0);
    expect(a.topProducts).toEqual([]);
    expect(a.byHour).toHaveLength(24);
  });

  it("sums revenue and tips and computes the average ticket", () => {
    const a = computeAnalytics(
      [
        order({ total: 100, tip: 10 }),
        order({ total: 50, tip: 5 }),
      ],
      "today",
    );
    expect(a.revenue).toBe(150);
    expect(a.tips).toBe(15);
    expect(a.orderCount).toBe(2);
    expect(a.avgTicket).toBe(75);
  });

  it("coerces string totals (Postgres numeric comes back as text)", () => {
    const a = computeAnalytics(
      [order({ total: "20.50" as unknown as number, tip: "1.50" as unknown as number })],
      "today",
    );
    expect(a.revenue).toBe(20.5);
    expect(a.tips).toBe(1.5);
  });

  it("aggregates product quantity and revenue including extras", () => {
    const withExtra = line({
      itemId: "i2",
      name: "Gyoza",
      price: 80,
      qty: 2,
      extras: [{ id: "e1", name: "Extra sauce", emoji: "🥫", price: 20 }],
    });
    const a = computeAnalytics([order({ items: [withExtra] })], "today");
    const gyoza = a.topProducts.find(p => p.name === "Gyoza");
    expect(gyoza).toBeTruthy();
    expect(gyoza!.qty).toBe(2);
    // (80 base + 20 extra) * 2 = 200
    expect(gyoza!.revenue).toBe(200);
  });

  it("ranks top products by quantity, capped at 10", () => {
    const orders = Array.from({ length: 12 }, (_, i) =>
      order({
        items: [line({ itemId: `p${i}`, name: `Item ${i}`, qty: i + 1 })],
      }),
    );
    const a = computeAnalytics(orders, "today");
    expect(a.topProducts).toHaveLength(10);
    // Highest qty (12) should lead.
    expect(a.topProducts[0].qty).toBe(12);
    expect(a.topProducts[0].qty).toBeGreaterThanOrEqual(a.topProducts[1].qty);
  });

  it("buckets an order into its created-at hour", () => {
    const at9 = new Date();
    at9.setHours(9, 15, 0, 0);
    const a = computeAnalytics([order({ created_at: at9.toISOString() })], "today");
    expect(a.byHour[9].count).toBe(1);
    const total = a.byHour.reduce((s, h) => s + h.count, 0);
    expect(total).toBe(1);
  });
});
