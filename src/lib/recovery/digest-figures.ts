import { readOpenAccountDebt } from "@/lib/account-balances-read";
import { readAnalyticsOrders, readCortePayments } from "@/lib/analytics-read";
import { computeAnalytics } from "@/lib/analytics";
import { corteFrom } from "@/lib/corte";
import { readCorteAdjustments } from "@/lib/corte-adjustments";
import { localDayKey, startOfLocalDay, subtractLocalDays } from "@/lib/day-window";
import { round2 } from "@/lib/money";
import { everyRow } from "@/lib/paged";
import { reportDiscounts } from "@/lib/report-discounts";
import { readCompletedReturns } from "@/lib/refunds/reporting";
import { withReturnComponents } from "@/lib/return-components";
import type { RecoveryContext } from "./job";

type Db = RecoveryContext["db"];
interface RestaurantDay {
  restaurant_id: string;
  currency: string;
  timezone: string;
  digest_day: string;
}

export async function readDigestFigures(db: Db, restaurant: RestaurantDay, now: Date) {
  const { restaurant_id: id, currency, timezone } = restaurant;
  const end = startOfLocalDay(now, timezone);
  const day = subtractLocalDays(end, 1, timezone);
  if (localDayKey(day, timezone) !== restaurant.digest_day) throw new Error("Digest day changed");
  const comparisonDay = subtractLocalDays(day, 7, timezone);
  const comparisonEnd = subtractLocalDays(day, 6, timezone);
  const from = day.toISOString();
  const to = end.toISOString();
  const current = await readAnalyticsOrders(db, id, currency, from, to);
  const analytics = computeAnalytics(await withReturnComponents(db, id, current), "today", timezone, day);
  if (analytics.revenue <= 0) return null;

  const [previous, payments, adjustments, discounts, refunds, attention] = await Promise.all([
    readAnalyticsOrders(db, id, currency, comparisonDay.toISOString(), comparisonEnd.toISOString())
      .then(rows => withReturnComponents(db, id, rows)),
    readCortePayments(db, id, currency, from, to),
    readCorteAdjustments(db, id, currency, from, to),
    reportDiscounts(db, id, currency, from, to),
    readCompletedReturns(db, id, currency, from, to, true),
    readAttention(db, id, from, to),
  ]);
  const previousRevenue = computeAnalytics(previous, "today", timezone, comparisonDay).revenue;
  // The Analytics corte's own adjustments, so cash and card read as it does.
  const takings = corteFrom(payments, adjustments.verified);
  const dineIn = current.filter(o => o.table_id || o.table_label).length;
  return {
    day,
    sales: analytics.revenue,
    salesChange: previousRevenue > 0 ? Math.round(100 * (analytics.revenue - previousRevenue) / previousRevenue) : null,
    count: analytics.orderCount,
    avgTicket: analytics.avgTicket,
    dineIn,
    toGo: analytics.orderCount - dineIn,
    card: round2(takings.totals.card + takings.online),
    cash: takings.totals.cash,
    tips: analytics.tips,
    discounts,
    refunds,
    attention,
    dishes: analytics.topProducts.slice(0, 3),
  };
}

export type DigestFigures = NonNullable<Awaited<ReturnType<typeof readDigestFigures>>>;

async function readAttention(db: Db, id: string, from: string, to: string) {
  const [discounts, writeOffs, offline, due, accounts, stock] = await Promise.all([
    db.from("discount_requests").select("id", { count: "exact", head: true }).eq("restaurant_id", id).eq("status", "pending"),
    db.from("write_off_requests").select("id", { count: "exact", head: true }).eq("restaurant_id", id).eq("status", "pending"),
    db.from("offline_sale_queue").select("pos_ref", { count: "exact", head: true }).eq("restaurant_id", id)
      .is("approved_at", null).is("resolved_at", null),
    db.from("refunds_due").select("id", { count: "exact", head: true }).eq("restaurant_id", id).is("refunded_at", null),
    readOpenAccountDebt(db, id),
    everyRow<{ item_id: string; name: string }>((a, b) => db.from("menu_stockouts").select("item_id, name")
      .eq("restaurant_id", id).gte("created_at", from).lt("created_at", to)
      .order("created_at").order("item_id").range(a, b), "the items that ran out"),
  ]);
  const stockouts = new Map(stock.map(row => [row.item_id, row.name]));
  return { discounts: count(discounts), writeOffs: count(writeOffs), offline: count(offline), due: count(due),
    accounts, stockouts: [...stockouts.values()] };
}

function count(result: { count: number | null; error: { message: string } | null }): number {
  if (result.error || result.count === null) throw new Error("Could not count items needing attention");
  return result.count;
}
