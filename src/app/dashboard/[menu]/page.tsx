import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership, MANAGES } from "@/lib/membership";
import MenuEditor from "@/components/dashboard/menu/MenuEditor";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { menuSlug } from "@/lib/slug";
import type { Menu } from "@/lib/types";
import { currentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

// /dashboard/{menu-name} — edit one menu's sections, products and extras.
export default async function MenuEditorPage({
  params,
}: {
  params: Promise<{ menu: string }>;
}) {
  const { menu: slug } = await params;
  const supabase = await createClient();
  const user = await currentUser();
  if (!user) redirect("/login");

  // Owners and managers may edit menus; kitchen goes back to its board.
  const membership = await getMembership();
  if (!membership) redirect("/dashboard");
  if (!MANAGES(membership.role)) redirect("/dashboard/orders");
  const restaurant = membership.restaurant;

  const { data: menus } = await supabase
    .from("menus")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .order("sort_order");

  const menu = ((menus as Menu[]) ?? []).find(m => menuSlug(m.name) === slug);
  if (!menu) redirect("/dashboard");

  return (
    <ConfirmProvider>
      <MenuEditor restaurant={restaurant} menuId={menu.id} menuName={menu.name} />
    </ConfirmProvider>
  );
}
