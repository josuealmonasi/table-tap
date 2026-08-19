import { describe, it, expect } from "vitest";
import {
  computeAnalytics,
  periodRange,
  normalisePeriod,
  type AnalyticsOrder,
} from "@/lib/analytics";
import type { OrderLineItem } from "@/lib/types";
import { localDayKey, localHour } from "@/lib/day-window";

// Every boundary here is the restaurant's, so these hold whatever zone CI runs in.
const MX = "America/Mexico_City";

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
  const now = new Date("2026-07-18T21:30:00Z"); // 15:30 Saturday in Mexico City

  it("'today' spans the restaurant's day into tomorrow", () => {
    const { start, end } = periodRange("today", now, MX);
    expect(localDayKey(start, MX)).toBe("2026-07-18");
    expect(localHour(start, MX)).toBe(0);
    expect(localDayKey(end, MX)).toBe("2026-07-19");
    expect(localHour(end, MX)).toBe(0);
  });

  it("'7d' starts six days back (7 days inclusive)", () => {
    const { start } = periodRange("7d", now, MX);
    expect(localDayKey(start, MX)).toBe("2026-07-12");
  });

  it("'30d' starts 29 days back", () => {
    const { start } = periodRange("30d", now, MX);
    expect(localDayKey(start, MX)).toBe("2026-06-19");
  });

  it("'month' starts on the first of the current month", () => {
    const { start } = periodRange("month", now, MX);
    expect(localDayKey(start, MX)).toBe("2026-07-01");
  });

  it("keeps a late dinner inside today, not tomorrow", () => {
    // 20:30 on the 18th in Mexico City is already the 19th in UTC. Left to the
    // server, tonight's service would land in tomorrow's takings.
    const dinner = new Date("2026-07-19T02:30:00Z");
    const { start, end } = periodRange("today", dinner, MX);
    expect(localDayKey(start, MX)).toBe("2026-07-18");
    expect(dinner >= start && dinner < end).toBe(true);
  });
});

describe("computeAnalytics", () => {
  it("returns zeroed totals with no orders", () => {
    const a = computeAnalytics([], "today", MX);
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
      MX,
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
      MX,
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
    const a = computeAnalytics([order({ items: [withExtra] })], "today", MX);
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
    const a = computeAnalytics(orders, "today", MX);
    expect(a.topProducts).toHaveLength(10);
    // Highest qty (12) should lead.
    expect(a.topProducts[0].qty).toBe(12);
    expect(a.topProducts[0].qty).toBeGreaterThanOrEqual(a.topProducts[1].qty);
  });

  it("buckets an order into the hour the restaurant served it", () => {
    // 09:15 in Mexico City, which is 15:15 UTC — the busy-hours chart pointed
    // six hours off when the server's clock decided this.
    const at9 = new Date("2026-07-18T15:15:00Z");
    const a = computeAnalytics([order({ created_at: at9.toISOString() })], "today", MX, at9);
    expect(a.byHour[9].count).toBe(1);
    const total = a.byHour.reduce((s, h) => s + h.count, 0);
    expect(total).toBe(1);
  });

  it("counts an evening order on the day it was served", () => {
    const dinner = new Date("2026-07-19T02:30:00Z"); // 20:30 on the 18th
    const a = computeAnalytics([order({ created_at: dinner.toISOString() })], "today", MX, dinner);
    expect(a.byDay).toHaveLength(1);
    expect(a.byDay[0].revenue).toBe(100);
    expect(a.byHour[20].count).toBe(1);
  });
});
