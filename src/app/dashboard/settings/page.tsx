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

  // Paying at the till comes with the plan. The switch is shown anyway, off and
  // saying what unlocks it: hiding it leaves the owner hunting for an option
  // that exists and nobody named.
  const plan = await getPlan(membership.restaurant.id);
  const counterPay = plan ? can(plan.limits, "counterPayment") : false;

  // The same thing the diner's menu computes, so Settings can tell the owner
  // exactly what their customer is seeing. Without this they turned on "pay at
  // the end" and nobody warned them online payment did not exist.
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
