import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MenuEditor from "@/components/dashboard/menu/MenuEditor";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { menuSlug } from "@/lib/slug";
import type { Menu, Restaurant } from "@/lib/types";

export const dynamic = "force-dynamic";

// /dashboard/{menu-name} — edit one menu's sections, products and extras.
export default async function MenuEditorPage({
  params,
}: {
  params: Promise<{ menu: string }>;
}) {
  const { menu: slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("owner_id", user.id)
    .single();
  if (!restaurant) redirect("/dashboard");

  const { data: menus } = await supabase
    .from("menus")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .order("sort_order");

  const menu = ((menus as Menu[]) ?? []).find((m) => menuSlug(m.name) === slug);
  if (!menu) redirect("/dashboard");

  return (
    <ConfirmProvider>
      <MenuEditor restaurant={restaurant as Restaurant} menuId={menu.id} menuName={menu.name} />
    </ConfirmProvider>
  );
}
