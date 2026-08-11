import { createClient } from "@/lib/supabase/server";
import OrderingApp from "@/components/customer/OrderingApp";
import { loadOrderingData, unwrap } from "@/lib/ordering-data";
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
  const [data, tableRes] = await Promise.all([
    loadOrderingData(restaurantId),
    supabase.from("restaurant_tables").select("*").eq("id", tableId).single(),
  ]);

  // An unknown table id is fine — the menu still works, the order just isn't
  // tagged. A failed lookup is not fine: it would drop the tag silently and
  // the food would reach the pass with no table to run it to, so unwrap throws.
  const table = unwrap<RestaurantTable>(tableRes, "table");

  // Reached only when the restaurant genuinely doesn't exist; a transient
  // fault has already thrown, rather than telling the customer their QR code
  // points at nothing.
  if (!data.restaurant) notFound();

  return (
    <OrderingApp
      restaurant={data.restaurant}
      table={table}
      categories={data.categories}
      items={data.items}
      extras={data.extras}
      extrasByProduct={data.extrasByProduct}
      combos={data.combos}
      promos={data.promos}
      ratings={data.ratings}
      closedNow={data.closedNow}
    />
  );
}
