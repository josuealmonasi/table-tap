import { requireOwner } from "@/lib/page-guard";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import StaffPanel from "@/components/dashboard/staff/StaffPanel";

export const dynamic = "force-dynamic";

// /dashboard/staff — owner-only: manage staff logins for the orders board.
export default async function StaffPage() {
  const membership = await requireOwner();

  return (
    <ConfirmProvider>
      {/* La bitácora se mudó a Cuentas abiertas: registra dinero que se movió
          —efectivo cobrado, deudas canceladas, promociones aplicadas— y sólo
          vivía aquí porque empezó siendo "quién tocó qué acceso". */}
      <StaffPanel restaurantId={membership.restaurant.id} />
    </ConfirmProvider>
  );
}
