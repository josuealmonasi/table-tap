import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/membership";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import StaffPanel from "@/components/dashboard/staff/StaffPanel";
import UserLogs from "@/components/dashboard/staff/UserLogs";

export const dynamic = "force-dynamic";

// /dashboard/staff — owner-only: manage staff logins for the orders board.
export default async function StaffPage() {
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership) redirect("/login");
  if (membership.role === "kitchen") redirect("/dashboard/orders");
  if (membership.role === "manager") redirect("/dashboard");

  return (
    <ConfirmProvider>
      <StaffPanel restaurantId={membership.restaurant.id}>
        <UserLogs restaurantId={membership.restaurant.id} />
      </StaffPanel>
    </ConfirmProvider>
  );
}
