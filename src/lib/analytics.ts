import { lineUnitPrice, type OrderLineItem } from "@/lib/types";
import {
  localDayKey,
  localHour,
  startOfLocalDay,
  startOfLocalMonth,
  startOfNextLocalDay,
  subtractLocalDays,
} from "@/lib/day-window";

export type Period = "today" | "7d" | "30d" | "month";

export const PERIODS: { key: Period; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
];

/** The minimal order shape analytics needs (paid, non-cancelled rows). */
export interface AnalyticsOrder {
  total: number;
  tip: number;
  created_at: string;
  items: OrderLineItem[];
}

export interface DayBar {
  label: string; // e.g. "Mon 14"
  revenue: number;
}
export interface HourBar {
  hour: number; // 0–23
  count: number;
}
export interface ProductStat {
  name: string;
  emoji: string;
  qty: number;
  revenue: number;
}

export interface Analytics {
  revenue: number;
  orderCount: number;
  avgTicket: number;
  tips: number;
  byDay: DayBar[];
  byHour: HourBar[];
  topProducts: ProductStat[];
}

/**
 * [start, end) for a period, on the restaurant's calendar.
 *
 * Not the server's: hosted in UTC, a Mexico City restaurant's "today" would
 * start at six the previous evening, so every evening service would be split
 * across two days and the owner would never see a night's takings whole.
 */
export function periodRange(
  period: Period,
  now = new Date(),
  timeZone: string,
): { start: Date; end: Date } {
  const end = startOfNextLocalDay(now, timeZone);
  if (period === "7d") return { start: subtractLocalDays(now, 6, timeZone), end };
  if (period === "30d") return { start: subtractLocalDays(now, 29, timeZone), end };
  if (period === "month") return { start: startOfLocalMonth(now, timeZone), end };
  return { start: startOfLocalDay(now, timeZone), end };
}

function normalisePeriod(value: string | undefined): Period {
  return PERIODS.some(p => p.key === value) ? (value as Period) : "today";
}
export { normalisePeriod };

/** Aggregates a period's orders into the numbers the analytics page shows. */
export function computeAnalytics(
  orders: AnalyticsOrder[],
  period: Period,
  timeZone: string,
  now = new Date(),
): Analytics {
  const revenue = orders.reduce((s, o) => s + Number(o.total), 0);
  const tips = orders.reduce((s, o) => s + Number(o.tip), 0);
  const orderCount = orders.length;
  const avgTicket = orderCount ? revenue / orderCount : 0;

  // Revenue per calendar day across the period's span (zero-filled). Walked a
  // restaurant-day at a time rather than in 24-hour steps, so the day a zone
  // changes its clocks stays one day instead of drifting an hour into the next.
  const { start, end } = periodRange(period, now, timeZone);
  const days: DayBar[] = [];
  const dayIndex = new Map<string, number>();
  const label = new Intl.DateTimeFormat([], {
    timeZone,
    weekday: "short",
    day: "2-digit",
  });
  for (let d = start; d < end; d = startOfNextLocalDay(d, timeZone)) {
    dayIndex.set(localDayKey(d, timeZone), days.length);
    days.push({ label: label.format(d), revenue: 0 });
  }

  const byHour: HourBar[] = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  const products = new Map<string, ProductStat>();

  for (const o of orders) {
    const when = new Date(o.created_at);
    const di = dayIndex.get(localDayKey(when, timeZone));
    if (di !== undefined) days[di].revenue += Number(o.total);
    byHour[localHour(when, timeZone)].count += 1;

    for (const line of o.items ?? []) {
      const key = line.itemId || line.name;
      const stat = products.get(key) ?? {
        name: line.name,
        emoji: line.emoji,
        qty: 0,
        revenue: 0,
      };
      stat.qty += line.qty;
      stat.revenue += lineUnitPrice(line) * line.qty;
      products.set(key, stat);
    }
  }

  const topProducts = [...products.values()]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  return {
    revenue: +revenue.toFixed(2),
    orderCount,
    avgTicket: +avgTicket.toFixed(2),
    tips: +tips.toFixed(2),
    byDay: days,
    byHour,
    topProducts,
  };
}
