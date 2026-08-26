import { requireManager } from "@/lib/page-guard";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { can, cheapestWith } from "@/lib/plan";
import { allPlans, getPlan } from "@/lib/plan-server";
import PromotionsPanel from "@/components/dashboard/promotions/PromotionsPanel";

export const dynamic = "force-dynamic";

// /dashboard/promotions — combo bundles and quantity deals. Owner + manager,
// same audience as menus and settings; kitchen/waiter don't reach it.
export default async function PromotionsPage() {
  const membership = await requireManager();

  // What this tier includes is decided here, on the server, so a locked panel
  // can never be talked into rendering by the browser.
  const [plan, catalog] = await Promise.all([
    getPlan(membership.restaurant.id),
    allPlans(),
  ]);
  const couponsAllowed = plan ? can(plan.limits, "coupons") : false;

  return (
    <ConfirmProvider>
      <PromotionsPanel
        restaurantId={membership.restaurant.id}
        currency={membership.restaurant.currency}
        couponsAllowed={couponsAllowed}
        couponsUnlockWith={cheapestWith(catalog, "coupons")?.plan ?? "casa"}
      />
    </ConfirmProvider>
  );
}
