import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MenuManager from "@/components/dashboard/menu/MenuManager";
import type { Restaurant } from "@/lib/types";

export const dynamic = "force-dynamic";

// /dashboard/menu — manage sections, products, and add-on items.
export default async function MenuPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("owner_id", user.id)
    .single();

  if (!restaurant) redirect("/dashboard");

  return <MenuManager restaurant={restaurant as Restaurant} />;
}
