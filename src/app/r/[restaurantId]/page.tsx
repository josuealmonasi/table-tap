import OrderingApp from "@/components/customer/OrderingApp";
import { loadOrderingData } from "@/lib/ordering-data";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

// /r/[restaurantId] — fast-food style: one QR for the whole restaurant, no
// table. Same active menu as the table route; the order carries no table.
export default async function RestaurantPage({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  const data = await loadOrderingData(restaurantId);

  if (!data.restaurant) notFound();

  return (
    <OrderingApp
      restaurant={data.restaurant}
      table={null}
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
