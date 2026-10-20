import { issueOfflineContext } from "@/lib/offline-authority";
import { currentUser } from "@/lib/current-user";
import { redirect } from "next/navigation";
import { getMembership, MANAGES, TAKES_COUNTER_ORDERS } from "@/lib/membership";
import { getPlan } from "@/lib/plan-server";
import { loyaltyOn } from "@/lib/loyalty/server";
import { can, dashboardFrozen } from "@/lib/plan";
import { loadOrderingData } from "@/lib/ordering-data";
import PosScreen from "@/components/dashboard/pos/PosScreen";
import UploadHeldSales from "@/components/dashboard/pos/UploadHeldSales";
import PlanLock from "@/components/dashboard/plan/PlanLock";
import { allPlans } from "@/lib/plan-server";
import { cheapestWith } from "@/lib/plan";
import { openShift } from "@/lib/cash-shift-server";
import { createClient } from "@/lib/supabase/server";
import { LIVE_FLOW } from "@/lib/order-flow";
import { topSellers } from "@/lib/pos-quick";
import type { Order, OrderLineItem } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * /dashboard/pos — the counter till.
 *
 * A cashier rings a sale face to face, takes cash or a card on the
 * restaurant's own terminal, and the order lands on the pass already paid for.
 * The customer is called by name when it is ready; there is nothing for them
 * to track, because they never had a phone in this at all.
 *
 * Reads the same menu the diner's own screen reads — same prices, same
 * availability, same open-menu rules — so a dish cannot be one thing at the
 * counter and another on a QR.
 */
export default async function PosPage() {
  const membership = await getMembership();
  if (!membership) redirect("/dashboard");
  if (!TAKES_COUNTER_ORDERS(membership.role)) redirect("/dashboard/orders");

  const plan = await getPlan(membership.restaurant.id);
  if (plan && dashboardFrozen(plan.status)) {
    return <div className="tt-dash"><div className="container"><UploadHeldSales restaurantId={membership.restaurant.id} /></div></div>;
  }
  if (!plan || !can(plan.limits, "pos")) {
    // Named, not merely locked: the screen says which tier carries the till.
    const unlocks = cheapestWith(await allPlans(), "pos", plan?.limits);
    return (
      <div className="tt-dash">
        <div className="container">
          <UploadHeldSales restaurantId={membership.restaurant.id} />
          <PlanLock feature="pos" unlocksWith={unlocks?.plan ?? "servicio"} isOwner={membership.role === "owner"} />
        </div>
      </div>
    );
  }

  // The till shows what has run out; the diner's menu never does.
  const data = await loadOrderingData(membership.restaurant.id, { includeSoldOut: true });
  if (!data.restaurant) redirect("/dashboard");

  // For the morning rush: the counter's orders still in the kitchen's hands
  // (the ready ones are called out from here), and what has actually sold
  // over the last two weeks, for the row at the top. Both are conveniences:
  // a failed read leaves the strip and the row empty, never the till.
  const supabase = await createClient();
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const [counterRes, soldRes] = await Promise.all([
    supabase.from("orders").select("*")
      .eq("restaurant_id", membership.restaurant.id).in("status", LIVE_FLOW).is("table_id", null)
      .order("created_at", { ascending: true }),
    supabase.from("orders").select("items")
      .eq("restaurant_id", membership.restaurant.id).neq("status", "cancelled").gte("created_at", since)
      .order("created_at", { ascending: false }).limit(1000),
  ]);
  if (counterRes.error) console.error("till: counter orders", counterRes.error.message);
  if (soldRes.error) console.error("till: best sellers", soldRes.error.message);

  const collector = (await currentUser())?.email ?? "staff";
  return (
    <PosScreen
      restaurant={data.restaurant}
      collectorContext={dashboardFrozen(plan.status) ? "" : issueOfflineContext(membership.restaurant.id, collector, data.restaurant.currency)}
      collector={collector}
      canRecover={MANAGES(membership.role)}
      categories={data.categories}
      items={data.items}
      extras={data.extras}
      extrasByProduct={data.extrasByProduct}
      promos={data.promos}
      combos={data.combos}
      closedNow={data.closedNow}
      dietaryTags={data.dietaryTags}
      canEmailReceipt={data.receipts}
      loyalty={await loyaltyOn(membership.restaurant.id, plan.limits)}
      canChargeAccount={can(plan.limits, "openAccounts")}
      shiftOpen={(await openShift(membership.restaurant.id)) !== null}
      counterOrders={(counterRes.data as Order[] | null) ?? []}
      bestSellers={topSellers((soldRes.data as { items: OrderLineItem[] | null }[] | null) ?? [], data.items)}
    />
  );
}
