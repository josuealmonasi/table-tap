import OrderTracker from "@/components/customer/OrderTracker";
import { fetchTrackedOrder } from "@/lib/order-tracking";
import { getLocale } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/context";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

// /order/[orderId] — live status after payment. The order is read server-side
// by its unguessable id via the secret key; the client key can't read orders.
export default async function OrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const [order, locale] = await Promise.all([fetchTrackedOrder(orderId), getLocale()]);
  if (!order) notFound();

  return (
    <LocaleProvider locale={locale}>
      <OrderTracker initialOrder={order} />
    </LocaleProvider>
  );
}
