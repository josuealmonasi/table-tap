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
import { corteFrom, EMPTY_CORTE, type CorteRow } from "@/lib/corte";

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
  // From the activity log, because it is the only place that records who
  // settled each bill. Read with the secret key: the log is the owner's to read
  // and stays that way, and this page is already manager-gated.
  const dayStart = startOfLocalDay(new Date(), timeZone);
  const { data: logRows } = await createAdminClient()
    .from("user_logs")
    .select("actor_email, entity, action, detail")
    .eq("restaurant_id", membership.restaurant.id)
    .in("action", ["paid", "written_off", "discounted"])
    .gte("created_at", dayStart.toISOString());
  const corte = logRows
    ? corteFrom(
        (logRows as { actor_email: string; entity: string; action: string; detail: string | null }[])
          .map(r => ({ actor: r.actor_email, entity: r.entity, action: r.action, detail: r.detail }) as CorteRow),
      )
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
  const admin = createAdminClient();
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
