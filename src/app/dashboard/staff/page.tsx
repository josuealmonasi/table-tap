import { requireOwner } from "@/lib/page-guard";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import StaffPanel from "@/components/dashboard/staff/StaffPanel";

export const dynamic = "force-dynamic";

// /dashboard/staff — owner-only: manage staff logins for the orders board.
export default async function StaffPage() {
  const membership = await requireOwner();

  return (
    <ConfirmProvider>
      {/* The activity log moved to Cuentas abiertas: it records money that
          moved — cash collected, debts written off, promotions applied — and
          only lived here because it began as "who touched which login". */}
      <StaffPanel restaurantId={membership.restaurant.id} />
    </ConfirmProvider>
  );
}
