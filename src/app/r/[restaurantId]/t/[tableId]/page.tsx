import { createClient } from "@/lib/supabase/server";
import OrderingApp from "@/components/customer/OrderingApp";
import type { Category, MenuItem, Restaurant, RestaurantTable } from "@/lib/types";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

// /r/[restaurantId]/t/[tableId] — the page a QR code points to.
export default async function TablePage({
  params,
}: {
  params: Promise<{ restaurantId: string; tableId: string }>;
}) {
  const { restaurantId, tableId } = await params;
  const supabase = await createClient();

  const [{ data: restaurant }, { data: table }, { data: categories }, { data: items }] =
    await Promise.all([
      supabase.from("restaurants").select("*").eq("id", restaurantId).single(),
      supabase.from("restaurant_tables").select("*").eq("id", tableId).single(),
      supabase
        .from("categories")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("sort_order"),
      supabase
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("available", true)
        .eq("is_addon", false) // add-ons are attached to products, not shown standalone
        .order("sort_order"),
    ]);

  if (!restaurant) notFound();

  return (
    <OrderingApp
      restaurant={restaurant as Restaurant}
      table={(table as RestaurantTable) ?? null}
      categories={(categories as Category[]) ?? []}
      items={(items as MenuItem[]) ?? []}
    />
  );
}
