import { requireManager } from "@/lib/page-guard";
import { can } from "@/lib/plan";
import { getPlan } from "@/lib/plan-server";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import SettingsForm from "@/components/dashboard/settings/SettingsForm";

export const dynamic = "force-dynamic";

// /dashboard/settings — owners edit everything; managers edit the operational
// bits (tax and order pausing). Kitchen/waiter don't reach it.
export default async function SettingsPage() {
  const membership = await requireManager();

  // Cobrar en la caja viene con el plan. El interruptor se enseña de todos
  // modos, apagado y diciendo qué lo abre: esconderlo deja al dueño buscando
  // una opción que existe y nadie le nombró.
  const plan = await getPlan(membership.restaurant.id);
  const counterPay = plan ? can(plan.limits, "counterPayment") : false;

  // Lo mismo que calcula el menú del comensal, para que Ajustes pueda decirle
  // al dueño exactamente lo que su cliente está viendo. Sin esto, encendía
  // "pagar al final" y nadie le avisaba de que el pago en línea no existía.
  const cardsEnabled = Boolean(
    membership.restaurant.stripe_account_id && membership.restaurant.stripe_charges_enabled,
  );

  // ConfirmProvider so the coupons panel can ask before deleting a code.
  return (
    <ConfirmProvider>
      <SettingsForm
        restaurant={membership.restaurant}
        role={membership.role}
        counterPayAllowed={counterPay}
        cardsEnabled={cardsEnabled}
      />
    </ConfirmProvider>
  );
}
