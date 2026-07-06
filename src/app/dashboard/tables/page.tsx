import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { qrSvg } from "@/lib/qr";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import TablesPanel, { type TableWithQr } from "@/components/dashboard/tables/TablesPanel";
import type { Restaurant, RestaurantTable } from "@/lib/types";

export const dynamic = "force-dynamic";

// /dashboard/tables — manage tables and their QR codes. Requires login.
export default async function TablesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id, name")
    .eq("owner_id", user.id)
    .single();
  if (!restaurant) redirect("/dashboard");
  const r = restaurant as Pick<Restaurant, "id" | "name">;

  const { data: tables } = await supabase
    .from("restaurant_tables")
    .select("*")
    .eq("restaurant_id", r.id)
    .order("label");
  const tableList = (tables as RestaurantTable[]) ?? [];

  // Absolute base URL so scanned QRs reach the deployed site (dev: localhost).
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  const fastFoodUrl = `${origin}/r/${r.id}`;
  const fastFood = { url: fastFoodUrl, svg: await qrSvg(fastFoodUrl) };

  const tableQrs: TableWithQr[] = await Promise.all(
    tableList.map(async (table) => {
      const url = `${origin}/r/${r.id}/t/${table.id}`;
      return { table, qr: { url, svg: await qrSvg(url) } };
    })
  );

  return (
    <ConfirmProvider>
      <TablesPanel restaurantId={r.id} restaurantName={r.name} fastFood={fastFood} tables={tableQrs} />
    </ConfirmProvider>
  );
}
