import { redirect } from "next/navigation";
import { getMembership, MANAGES } from "@/lib/membership";
import { can } from "@/lib/plan";
import { getPlan } from "@/lib/plan-server";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import SettingsForm from "@/components/dashboard/settings/SettingsForm";

export const dynamic = "force-dynamic";

// /dashboard/settings — owners edit everything; managers edit the operational
// bits (tax and order pausing). Kitchen/waiter don't reach it.
export default async function SettingsPage() {
  const membership = await getMembership();
  if (!membership) redirect("/login");
  if (!MANAGES(membership.role)) redirect("/dashboard/orders");

  // Cobrar en la caja viene con el plan. El interruptor se enseña de todos
  // modos, apagado y diciendo qué lo abre: esconderlo deja al dueño buscando
  // una opción que existe y nadie le nombró.
  const plan = await getPlan(membership.restaurant.id);
  const counterPay = plan ? can(plan.limits, "counterPayment") : false;

  // ConfirmProvider so the coupons panel can ask before deleting a code.
  return (
    <ConfirmProvider>
      <SettingsForm
        restaurant={membership.restaurant}
        role={membership.role}
        counterPayAllowed={counterPay}
      />
    </ConfirmProvider>
  );
}
