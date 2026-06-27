import { createClient } from "@/lib/supabase/server";
import OrderTracker from "@/components/customer/OrderTracker";
import type { Order } from "@/lib/types";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

// /order/[orderId] — live status after payment.
export default async function OrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (!order) notFound();

  return <OrderTracker initialOrder={order as Order} />;
}
