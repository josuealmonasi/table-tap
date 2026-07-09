import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SettingsForm from "@/components/dashboard/settings/SettingsForm";
import type { Restaurant } from "@/lib/types";

export const dynamic = "force-dynamic";

// /dashboard/settings — edit the restaurant's identity and service charge.
export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id, name, tagline, logo, currency, service_pct")
    .eq("owner_id", user.id)
    .single();
  if (!restaurant) redirect("/dashboard");

  return <SettingsForm restaurant={restaurant as Restaurant} />;
}
