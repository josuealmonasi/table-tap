import OrderingApp from "@/components/customer/OrderingApp";
import { loadOrderingData } from "@/lib/ordering-data";
import { getLocale } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/context";
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
  const [data, locale] = await Promise.all([
    loadOrderingData(restaurantId),
    getLocale(),
  ]);

  if (!data.restaurant) notFound();

  return (
    <LocaleProvider locale={locale}>
      <OrderingApp
        restaurant={data.restaurant}
        table={null}
        categories={data.categories}
        items={data.items}
        extras={data.extras}
        extrasByProduct={data.extrasByProduct}
      />
    </LocaleProvider>
  );
}
