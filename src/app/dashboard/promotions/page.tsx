import { redirect } from "next/navigation";
import { getMembership, MANAGES } from "@/lib/membership";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import PromotionsPanel from "@/components/dashboard/promotions/PromotionsPanel";

export const dynamic = "force-dynamic";

// /dashboard/promotions — combo bundles and quantity deals. Owner + manager,
// same audience as menus and settings; kitchen/waiter don't reach it.
export default async function PromotionsPage() {
  const membership = await getMembership();
  if (!membership) redirect("/login");
  if (!MANAGES(membership.role)) redirect("/dashboard/orders");

  return (
    <ConfirmProvider>
      <PromotionsPanel
        restaurantId={membership.restaurant.id}
        currency={membership.restaurant.currency}
      />
    </ConfirmProvider>
  );
}
