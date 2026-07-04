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

  // Only active menus are shown to customers. A restaurant can have several
  // active at once — the customer sees the union of their content.
  const { data: activeMenus } = await supabase
    .from("menus")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("active", true);
  const activeMenuIds = (activeMenus as { id: string }[] | null ?? []).map((m) => m.id);

  const [{ data: restaurant }, { data: table }, { data: categories }, { data: menuItems }] =
    await Promise.all([
      // Only the customer-facing columns (never owner_id / created_at).
      supabase.from("restaurants").select("id, name, tagline, logo, currency, service_pct").eq("id", restaurantId).single(),
      supabase.from("restaurant_tables").select("*").eq("id", tableId).single(),
      supabase
        .from("categories")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .in("menu_id", activeMenuIds.length ? activeMenuIds : ["00000000-0000-0000-0000-000000000000"])
        .order("sort_order"),
      // Products AND available add-on items; we split them client-side.
      supabase
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("available", true)
        .in("menu_id", activeMenuIds.length ? activeMenuIds : ["00000000-0000-0000-0000-000000000000"])
        .order("sort_order"),
    ]);

  if (!restaurant) notFound();

  const allItems = (menuItems as MenuItem[]) ?? [];
  const items = allItems.filter((i) => !i.is_addon);
  const extras = allItems.filter((i) => i.is_addon);

  // Which extras each product offers (product_id → addon_id[]).
  let extrasByProduct: Record<string, string[]> = {};
  const productIds = items.map((i) => i.id);
  if (productIds.length) {
    const { data: links } = await supabase
      .from("item_addons")
      .select("product_id, addon_id")
      .in("product_id", productIds);
    extrasByProduct = (links as { product_id: string; addon_id: string }[] | null ?? []).reduce(
      (map, { product_id, addon_id }) => {
        (map[product_id] ??= []).push(addon_id);
        return map;
      },
      {} as Record<string, string[]>
    );
  }

  return (
    <OrderingApp
      restaurant={restaurant as Restaurant}
      table={(table as RestaurantTable) ?? null}
      categories={(categories as Category[]) ?? []}
      items={items}
      extras={extras}
      extrasByProduct={extrasByProduct}
    />
  );
}
