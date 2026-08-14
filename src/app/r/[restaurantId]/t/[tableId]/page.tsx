import { Suspense } from "react";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import OrderingApp from "@/components/customer/OrderingApp";
import MenuSkeleton from "@/components/customer/MenuSkeleton";
import { loadCoverState, loadOrderingData, unwrap } from "@/lib/ordering-data";
import type { RestaurantTable } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The menu itself. Split out so the shell can render while this loads. */
async function Menu({
  restaurantId,
  tableId,
}: {
  restaurantId: string;
  tableId: string;
}) {
  // Read with the secret key, scoped to both ids in the URL. Tables are not
  // readable with the publishable key on purpose — listable table ids would let
  // anyone see any table's bill, or charge an order to it — so the QR code the
  // diner scanned is what proves which table this is.
  const [data, tableRes] = await Promise.all([
    loadOrderingData(restaurantId),
    createAdminClient()
      .from("restaurant_tables")
      .select("*")
      .eq("id", tableId)
      .eq("restaurant_id", restaurantId)
      .single(),
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

// /r/[restaurantId]/t/[tableId] — the page a table QR points to. Same menu as
// the fast-food route, but the order is tagged with this table.
//
// The cover state is fetched first so the skeleton reserves the right height;
// see the note on the fast-food route.
export default async function TablePage({
  params,
}: {
  params: Promise<{ restaurantId: string; tableId: string }>;
}) {
  const { restaurantId, tableId } = await params;
  const { exists, cover } = await loadCoverState(restaurantId);
  if (!exists) notFound();

  return (
    <Suspense fallback={<MenuSkeleton table cover={cover} />}>
      <Menu restaurantId={restaurantId} tableId={tableId} />
    </Suspense>
  );
}
