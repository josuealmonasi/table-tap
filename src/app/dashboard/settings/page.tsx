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

  // Letting the food out before it is paid for comes with the plan. The switch
  // is shown anyway, off and saying what unlocks it: hiding it leaves the owner
  // hunting for an option that exists and nobody named.
  const plan = await getPlan(membership.restaurant.id);
  const deferredPay = plan ? can(plan.limits, "deferredPayment") : false;

  // Counting stock is a paid feature. Shown on every plan and switched off on
  // the free one, so the owner can see what upgrading buys them.
  const inventory = plan ? can(plan.limits, "inventory") : false;

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
        deferredPayAllowed={deferredPay}
        inventoryAllowed={inventory}
        cardsEnabled={cardsEnabled}
      />
    </ConfirmProvider>
  );
}
