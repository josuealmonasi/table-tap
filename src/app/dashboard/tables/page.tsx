import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/page-guard";
import { qrSvg } from "@/lib/qr";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import TablesPanel, { type TableWithQr } from "@/components/dashboard/tables/TablesPanel";
import { tableStatuses } from "@/lib/table-status";
import { can, cheapestWith } from "@/lib/plan";
import { allPlans, getPlan } from "@/lib/plan-server";
import type { Order } from "@/lib/types";
import type { RestaurantTable } from "@/lib/types";

export const dynamic = "force-dynamic";

// /dashboard/tables — manage tables and their QR codes. Requires login.
export default async function TablesPage() {
  const supabase = await createClient();
  // Owners and managers may manage tables; kitchen goes back to its board.
  const membership = await requireManager();
  const r = membership.restaurant;

  // Tables come with the tier. Without this the panel offered "+ Agregar mesa"
  // on the free plan, and the database refused the insert with a plan-limit
  // trigger the owner never saw coming.
  const [plan, catalog] = await Promise.all([getPlan(r.id), allPlans()]);
  const tablesAllowed = plan ? can(plan.limits, "dineIn") : false;
  const tablesUnlockWith = cheapestWith(catalog, "dineIn")?.plan ?? "servicio";

  const [{ data: tables }, { data: openOrders }] = await Promise.all([
    supabase
      .from("restaurant_tables")
      .select("*")
      .eq("restaurant_id", r.id)
      .order("label"),
    // Whether each table is free is derived from what is still owed on it,
    // rather than a flag somebody has to remember to clear.
    supabase
      .from("orders")
      .select("id, table_id, total, paid, written_off, status, created_at")
      .eq("restaurant_id", r.id)
      .eq("paid", false)
      .eq("written_off", false),
  ]);
  const tableList = (tables as RestaurantTable[]) ?? [];

  // Absolute base URL so scanned QRs reach the deployed site (dev: localhost).
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  const fastFoodUrl = `${origin}/r/${r.id}`;
  const fastFood = { url: fastFoodUrl, svg: await qrSvg(fastFoodUrl) };

  const tableQrs: TableWithQr[] = await Promise.all(
    tableList.map(async table => {
      const url = `${origin}/r/${r.id}/t/${table.id}`;
      return { table, qr: { url, svg: await qrSvg(url) } };
    }),
  );

  return (
    <ConfirmProvider>
      <TablesPanel
        restaurantId={r.id}
        restaurantName={r.name}
        fastFood={fastFood}
        tables={tableQrs}
        statuses={Object.fromEntries(tableStatuses((openOrders as Order[]) ?? []))}
        currency={r.currency}
        tablesAllowed={tablesAllowed}
        tablesUnlockWith={tablesUnlockWith}
      />
    </ConfirmProvider>
  );
}
