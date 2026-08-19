import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import OrderingApp from "@/components/customer/OrderingApp";
import { fetchTrackedOrder } from "@/lib/order-tracking";
import { loadOrderingData, unwrap } from "@/lib/ordering-data";
import type { RestaurantTable } from "@/lib/types";

export const dynamic = "force-dynamic";

// /order/[orderId] — live status after paying, and where Stripe returns to.
// The order is read server-side by its unguessable id with the secret key; the
// publishable key can't read orders at all.
//
// It renders the restaurant's own menu with the tracker open over it. A status
// dialog needs something behind it or it is just a card on an empty page — and
// the menu is where the diner goes next in any case, so it is already loaded
// when they close the tracker or decide on dessert.
export default async function OrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const order = await fetchTrackedOrder(orderId);
  if (!order) notFound();

  const [data, tableRes] = await Promise.all([
    loadOrderingData(order.restaurant_id),
    order.table_id
      ? createAdminClient()
          .from("restaurant_tables")
          .select("*")
          .eq("id", order.table_id)
          .eq("restaurant_id", order.restaurant_id)
          .single()
      : null,
  ]);

  if (!data.restaurant) notFound();
  // A table that has since been deleted still tracks fine — the order carries
  // its own label. Anything else is a real fault and throws rather than
  // quietly dropping the table from the menu behind.
  const table = tableRes ? unwrap<RestaurantTable>(tableRes, "table") : null;

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
      receipts={data.receipts}
      trackOrder={order}
    />
  );
}
