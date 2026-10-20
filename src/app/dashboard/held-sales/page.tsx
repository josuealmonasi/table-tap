import { requireMembership } from "@/lib/page-guard";
import { MANAGES, TAKES_COUNTER_ORDERS } from "@/lib/membership";
import { redirect } from "next/navigation";
import UploadHeldSales from "@/components/dashboard/pos/UploadHeldSales";
import Breadcrumb from "@/components/layout/Breadcrumb";
import HeldSales from "@/components/dashboard/pos/HeldSales";

export const dynamic = "force-dynamic";

/** Past collections remain recoverable after a plan ends. New sales still
 * go through the ordinary till's entitlement and pricing checks. */
export default async function HeldSalesPage() {
  const { restaurant, role } = await requireMembership();
  if (!TAKES_COUNTER_ORDERS(role)) redirect("/dashboard/orders");
  return <div className="tt-dash"><div className="container">
    <header className="tt-dash-head"><Breadcrumb trail={[
      { labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "recovery.title" },
    ]} /></header>
    {MANAGES(role) ? <HeldSales restaurantId={restaurant.id} currency={restaurant.currency} /> : <UploadHeldSales restaurantId={restaurant.id} />}
  </div></div>;
}
