import { Suspense } from "react";
import { notFound } from "next/navigation";
import OrderingApp from "@/components/customer/OrderingApp";
import MenuSkeleton from "@/components/customer/MenuSkeleton";
import { loadCoverState, loadOrderingData } from "@/lib/ordering-data";

export const dynamic = "force-dynamic";

/** The menu itself. Split out so the shell can render while this loads. */
async function Menu({ restaurantId }: { restaurantId: string }) {
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
      receipts={data.receipts}
      dietaryTags={data.dietaryTags}
    />
  );
}

// /r/[restaurantId] — fast-food style: one QR for the whole restaurant, no
// table. Same active menu as the table route; the order carries no table.
//
// The cover state is fetched first, on its own, because the skeleton has to
// know whether to hold room for a photo — `loading.tsx` is given no params, so
// it cannot answer that. It is one indexed row; the menu, its categories,
// promotions and ratings stream in behind it.
export default async function RestaurantPage({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;
  const { exists, cover } = await loadCoverState(restaurantId);
  if (!exists) notFound();

  return (
    <Suspense fallback={<MenuSkeleton cover={cover} />}>
      <Menu restaurantId={restaurantId} />
    </Suspense>
  );
}
