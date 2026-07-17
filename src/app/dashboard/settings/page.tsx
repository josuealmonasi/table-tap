import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership, MANAGES } from "@/lib/membership";
import SettingsForm from "@/components/dashboard/settings/SettingsForm";

export const dynamic = "force-dynamic";

// /dashboard/settings — owners edit everything; managers edit the operational
// bits (tax and order pausing). Kitchen/waiter don't reach it.
export default async function SettingsPage() {
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership) redirect("/login");
  if (!MANAGES(membership.role)) redirect("/dashboard/orders");

  return <SettingsForm restaurant={membership.restaurant} role={membership.role} />;
}
