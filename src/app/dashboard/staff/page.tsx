import { redirect } from "next/navigation";
import { getMembership } from "@/lib/membership";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import StaffPanel from "@/components/dashboard/staff/StaffPanel";

export const dynamic = "force-dynamic";

// /dashboard/staff — owner-only: manage staff logins for the orders board.
export default async function StaffPage() {
  const membership = await getMembership();
  if (!membership) redirect("/login");
  if (membership.role === "kitchen" || membership.role === "waiter")
    redirect("/dashboard/orders");
  if (membership.role === "manager") redirect("/dashboard");

  return (
    <ConfirmProvider>
      {/* La bitácora se mudó a Cuentas abiertas: registra dinero que se movió
          —efectivo cobrado, deudas canceladas, promociones aplicadas— y sólo
          vivía aquí porque empezó siendo "quién tocó qué acceso". */}
      <StaffPanel restaurantId={membership.restaurant.id} />
    </ConfirmProvider>
  );
}
