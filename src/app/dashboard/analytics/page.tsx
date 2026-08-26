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

  // Lo que la gente opinó de los platillos. La función agrega por platillo;
  // los nombres salen del menú, para no repetir la misma consulta dos veces.
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
    />
  );
}
