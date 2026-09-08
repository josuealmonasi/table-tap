import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/page-guard";
import {
  computeAnalytics,
  normalisePeriod,
  periodRange,
  type AnalyticsOrder,
} from "@/lib/analytics";
import AnalyticsView, { type RatedDish } from "@/components/dashboard/analytics/AnalyticsView";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { startOfLocalDay } from "@/lib/day-window";
import { corteFrom, EMPTY_CORTE, type CorteAdjustment, type CortePayment } from "@/lib/corte";

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

  const { data: rows } = await supabase
    .from("orders")
    .select("total, tip, created_at, items")
    .eq("restaurant_id", membership.restaurant.id)
    .eq("paid", true)
    .neq("status", "cancelled")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());

  const data = computeAnalytics((rows as AnalyticsOrder[]) ?? [], period, timeZone);

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

  const [{ data: paidRows }, { data: givenUp }] = await Promise.all([
    admin
      .from("payments")
      .select("actor_email, amount, method")
      .eq("restaurant_id", membership.restaurant.id)
      .gte("created_at", since),
    admin
      .from("user_logs")
      .select("action, detail")
      .eq("restaurant_id", membership.restaurant.id)
      .in("action", ["written_off", "discounted"])
      .gte("created_at", since),
  ]);

  const corte = paidRows
    ? corteFrom(paidRows as CortePayment[], (givenUp ?? []) as CorteAdjustment[])
    : EMPTY_CORTE;
  const dayLabel = new Intl.DateTimeFormat("es-MX", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  // What people thought of the dishes. The function aggregates per dish; the
  // names come from the menu, to avoid running the same query twice.
  const [{ data: stats }, { data: dishes }] = await Promise.all([
    admin.rpc("dish_rating_stats", { p_restaurant_id: membership.restaurant.id }),
    admin
      .from("menu_items")
      .select("id, name, emoji")
      .eq("restaurant_id", membership.restaurant.id),
  ]);
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

  return (
    <AnalyticsView
      data={data}
      period={period}
      currency={membership.restaurant.currency}
      restaurantId={membership.restaurant.id}
      rated={rated}
      corte={corte}
      restaurantName={membership.restaurant.name}
      dayLabel={dayLabel}
    />
  );
}
