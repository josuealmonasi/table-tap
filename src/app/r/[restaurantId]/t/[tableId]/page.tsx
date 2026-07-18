import { createClient } from "@/lib/supabase/server";
import OrderingApp from "@/components/customer/OrderingApp";
import { loadOrderingData } from "@/lib/ordering-data";
import type { RestaurantTable } from "@/lib/types";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

// /r/[restaurantId]/t/[tableId] — the page a table QR points to. Same menu as
// the fast-food route, but the order is tagged with this table.
export default async function TablePage({
  params,
}: {
  params: Promise<{ restaurantId: string; tableId: string }>;
}) {
  const { restaurantId, tableId } = await params;

  const supabase = await createClient();
  const [data, { data: table }] = await Promise.all([
    loadOrderingData(restaurantId),
    supabase.from("restaurant_tables").select("*").eq("id", tableId).single(),
  ]);

  if (!data.restaurant) notFound();

  return (
    <OrderingApp
      restaurant={data.restaurant}
      table={(table as RestaurantTable) ?? null}
      categories={data.categories}
      items={data.items}
      extras={data.extras}
      extrasByProduct={data.extrasByProduct}
    />
  );
}
