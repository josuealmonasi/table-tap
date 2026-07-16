import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/membership";
import {
  computeAnalytics,
  normalisePeriod,
  periodRange,
  type AnalyticsOrder,
} from "@/lib/analytics";
import AnalyticsView from "@/components/dashboard/analytics/AnalyticsView";

export const dynamic = "force-dynamic";

// /dashboard/analytics — sales insights for the owner and managers.
// Kitchen never sees money aggregates, so it's bounced to the orders board.
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership) redirect("/login");
  if (membership.role === "kitchen") redirect("/dashboard/orders");

  const period = normalisePeriod((await searchParams).period);
  const { start, end } = periodRange(period);

  const { data: rows } = await supabase
    .from("orders")
    .select("total, tip, created_at, items")
    .eq("restaurant_id", membership.restaurant.id)
    .eq("paid", true)
    .neq("status", "cancelled")
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());

  const data = computeAnalytics((rows as AnalyticsOrder[]) ?? [], period);

  return (
    <AnalyticsView data={data} period={period} currency={membership.restaurant.currency} />
  );
}
