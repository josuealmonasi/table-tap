import { lineUnitPrice, type OrderLineItem } from "@/lib/types";

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

/** [start, end) for a period, in the server's local day. */
export function periodRange(period: Period, now = new Date()): { start: Date; end: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(24, 0, 0, 0); // start of tomorrow

  if (period === "7d") start.setDate(start.getDate() - 6);
  else if (period === "30d") start.setDate(start.getDate() - 29);
  else if (period === "month") {
    start.setDate(1);
  }
  return { start, end };
}

function normalisePeriod(value: string | undefined): Period {
  return PERIODS.some(p => p.key === value) ? (value as Period) : "today";
}
export { normalisePeriod };

/** Aggregates a period's orders into the numbers the analytics page shows. */
export function computeAnalytics(orders: AnalyticsOrder[], period: Period): Analytics {
  const revenue = orders.reduce((s, o) => s + Number(o.total), 0);
  const tips = orders.reduce((s, o) => s + Number(o.tip), 0);
  const orderCount = orders.length;
  const avgTicket = orderCount ? revenue / orderCount : 0;

  // Revenue per calendar day across the period's span (zero-filled).
  const { start, end } = periodRange(period);
  const days: DayBar[] = [];
  const dayIndex = new Map<string, number>();
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const key = d.toDateString();
    dayIndex.set(key, days.length);
    days.push({
      label: d.toLocaleDateString([], { weekday: "short", day: "2-digit" }),
      revenue: 0,
    });
  }

  const byHour: HourBar[] = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  const products = new Map<string, ProductStat>();

  for (const o of orders) {
    const when = new Date(o.created_at);
    const di = dayIndex.get(when.toDateString());
    if (di !== undefined) days[di].revenue += Number(o.total);
    byHour[when.getHours()].count += 1;

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
