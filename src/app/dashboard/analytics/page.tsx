import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import { dateLocale } from "@/lib/format";
import { requireManager } from "@/lib/page-guard";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import {
  computeAnalytics,
  normalisePeriod,
  periodRange,
  type AnalyticsOrder,
} from "@/lib/analytics";
import AnalyticsView, { type RatedDish } from "@/components/dashboard/analytics/AnalyticsView";
import { createAdminClient } from "@/lib/supabase/admin";
import { unwrap } from "@/lib/ordering-data";
import { getPlan } from "@/lib/plan-server";
import { can } from "@/lib/plan";
import { programOf } from "@/lib/loyalty/server";
import { readLoyaltyStats } from "@/lib/loyalty/analytics-read";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { startOfLocalDay } from "@/lib/day-window";
import { corteFrom, EMPTY_CORTE, type CorteAdjustment, type CortePayment } from "@/lib/corte";
import { todaysShiftViews } from "@/lib/cash-shift-server";
import { readTerminal } from "@/lib/terminal-server";
import { everyRow } from "@/lib/paged";
import type { OfflineSaleRow } from "@/components/dashboard/analytics/OfflineSalesCard";

export const dynamic = "force-dynamic";

// /dashboard/analytics — sales insights for the owner and managers.
// Kitchen never sees money aggregates, so it's bounced to the orders board.
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const supabase = await createClient();
  const membership = await requireManager();

  const period = normalisePeriod((await searchParams).period);
  // The restaurant's own calendar, not the host's — see lib/day-window.
  const timeZone = membership.restaurant.timezone ?? DEFAULT_TIME_ZONE;
  const { start, end } = periodRange(period, new Date(), timeZone);

  // Unwrapped, like every read on this page: a failed read taken as empty
  // told the owner they had sold nothing and the drawer held nothing. The error
  // screen offers a retry instead, which is the honest answer.
  // Every row of the period: one read stops at the server's row cap without
  // saying so, and a month of a busy café read at once is its first thousand
  // orders. A failed page throws to the error screen, like any failed read.
  const rows = await everyRow<AnalyticsOrder>((a, b) => supabase
    .from("orders")
    .select("total, tip, created_at, items")
    .eq("restaurant_id", membership.restaurant.id)
    .eq("paid", true)
    .neq("status", "cancelled")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())
    .order("id").range(a, b), "the period's sales");

  const locale = await getLocale();
  const data = computeAnalytics(rows, period, timeZone, new Date(), locale);

  // The register close is always TODAY, whatever period the charts are showing.
  // A corte is the thing somebody signs at the end of a shift; a corte "for the
  // last 30 days" is not a document anybody counts a drawer against.
  //
  // Money that arrived comes from the ledger, where an amount is a number the
  // database checked rather than a word in a sentence. Money that never
  // arrived cannot be in a payments table at all, so write-offs and discounts
  // still come from the log, which is where giving them up was recorded.
  //
  // Both read with the secret key: neither is readable from a browser and both
  // stay that way, and this page is already manager-gated.
  const dayStart = startOfLocalDay(new Date(), timeZone);
  const admin = createAdminClient();
  const since = dayStart.toISOString();

  const [paidRows, givenUp, owedRows] = await Promise.all([
    everyRow<CortePayment>((a, b) => admin
      .from("payments")
      .select("actor_email, amount, method")
      .eq("restaurant_id", membership.restaurant.id)
      .gte("created_at", since)
      .order("id").range(a, b), "today's takings"),
    everyRow<CorteAdjustment>((a, b) => admin
      .from("user_logs")
      .select("action, detail")
      .eq("restaurant_id", membership.restaurant.id)
      // "refunded" is money handed back after it arrived. It comes out of the
      // drawer of whoever took it, which is why the corte needs to see it.
      // "charged" is food put on a customer's account: out of the kitchen,
      // owed, and in nobody's drawer.
      .in("action", ["written_off", "discounted", "refunded", "charged"])
      .gte("created_at", since)
      .order("id").range(a, b), "today's write-offs and discounts"),
    // What customers owe on their accounts right now, however old.
    everyRow<{ total: number }>((a, b) => admin
      .from("orders")
      .select("total")
      .eq("restaurant_id", membership.restaurant.id)
      .not("account_id", "is", null)
      .eq("paid", false).eq("written_off", false)
      .neq("status", "cancelled")
      .order("id").range(a, b), "what customer accounts owe"),
  ]);
  const corte = paidRows
    ? {
        ...corteFrom(paidRows as CortePayment[], (givenUp ?? []) as CorteAdjustment[]),
        accountsOwed: Math.round((owedRows ?? []).reduce((s, o) => s + Number(o.total), 0) * 100) / 100,
      }
    : EMPTY_CORTE;
  // The drawer it is counted against, shift by shift: today's, and the one
  // still open. A failed read throws to the error screen — a drawer shown as
  // empty would be a wrong number to count to.
  const shifts = await todaysShiftViews(membership.restaurant.id, dayStart);
  // In the owner's language: the day is words, and "martes 23 de septiembre"
  // above an English corte is a Spanish sentence on an English page.
  const dayLabel = new Intl.DateTimeFormat(dateLocale(locale), {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  // What people thought of the dishes. The function aggregates per dish; the
  // names come from the menu, to avoid running the same query twice.
  const [statsRes, dishesRes] = await Promise.all([
    admin.rpc("dish_rating_stats", { p_restaurant_id: membership.restaurant.id }),
    admin
      .from("menu_items")
      .select("id, name, emoji")
      .eq("restaurant_id", membership.restaurant.id),
  ]);
  const stats = unwrap(statsRes, "the dish ratings");
  const dishes = unwrap(dishesRes, "the dishes");
  const nameOf = new Map(
    ((dishes ?? []) as { id: string; name: string; emoji: string | null }[]).map(d => [
      d.id,
      d,
    ]),
  );
  const rated = ((stats ?? []) as { item_id: string; avg_rating: number; rating_count: number }[])
    .map(r => {
      const dish = nameOf.get(r.item_id);
      return dish
        ? {
            itemId: r.item_id,
            name: dish.name,
            emoji: dish.emoji,
            avg: Number(r.avg_rating),
            count: Number(r.rating_count),
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b!.count - a!.count)
    .slice(0, 12) as RatedDish[];

  // The visit card over the same period as the charts, for a restaurant that
  // runs one. Read with the secret key, like the corte: none of it is readable
  // from a browser, and this page is already manager-gated.
  const plan = await getPlan(membership.restaurant.id);
  const loyalty =
    plan && can(plan.limits, "loyalty") && (await programOf(membership.restaurant.id))
      ? await readLoyaltyStats(admin, membership.restaurant.id, start, end)
      : null;

  // The restaurant's own card terminal, on a tier with the till: what it took
  // and what the bank should deposit. A failed read throws to the error
  // screen, like the corte — a deposit shown as missing is a wrong number.
  const terminal = plan && can(plan.limits, "pos") ? await readTerminal(membership.restaurant.id, timeZone) : null;
  // The till's sales rung without a connection, newest first, so a manager
  // sees any whose amount the menu would not have charged.
  const offlineRows = unwrap(
    await admin.from("orders").select("id, offline_at, total, offline_drift")
      .eq("restaurant_id", membership.restaurant.id).not("offline_at", "is", null)
      .gte("offline_at", new Date(Date.now() - 14 * 86_400_000).toISOString())
      .order("offline_at", { ascending: false }).limit(200),
    "the sales rung without a connection",
  ) as OfflineSaleRow[] | null;

  // The drawer's withdrawals are struck off through a confirm dialog.
  return (
    <ConfirmProvider>
    <AnalyticsView
      data={data}
      period={period}
      currency={membership.restaurant.currency}
      restaurantId={membership.restaurant.id}
      rated={rated}
      corte={corte}
      shifts={shifts}
      timeZone={timeZone}
      restaurantName={membership.restaurant.name}
      dayLabel={dayLabel}
      loyalty={loyalty}
      terminal={terminal}
      offlineSales={(offlineRows ?? []).map(o => ({
        ...o, total: Number(o.total), offline_drift: o.offline_drift === null ? null : Number(o.offline_drift),
      }))}
    />
    </ConfirmProvider>
  );
}
