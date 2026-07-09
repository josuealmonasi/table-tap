import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/membership";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import StaffPanel from "@/components/dashboard/staff/StaffPanel";

export const dynamic = "force-dynamic";

// /dashboard/staff — owner-only: manage staff logins for the orders board.
export default async function StaffPage() {
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership) redirect("/login");
  if (membership.role !== "owner") redirect("/dashboard/orders");

  return (
    <ConfirmProvider>
      <StaffPanel restaurantId={membership.restaurant.id} />
    </ConfirmProvider>
  );
}
