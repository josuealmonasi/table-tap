import { redirect } from "next/navigation";
import { getMembership, TAKES_COUNTER_ORDERS } from "@/lib/membership";
import { getPlan } from "@/lib/plan-server";
import { can } from "@/lib/plan";
import { loadOrderingData } from "@/lib/ordering-data";
import PosScreen from "@/components/dashboard/pos/PosScreen";
import PlanLock from "@/components/dashboard/plan/PlanLock";
import { allPlans } from "@/lib/plan-server";
import { cheapestWith } from "@/lib/plan";

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
  if (!plan || !can(plan.limits, "pos")) {
    // Named, not merely locked: the screen says which tier carries the till.
    const unlocks = cheapestWith(await allPlans(), "pos");
    return (
      <div className="tt-dash">
        <div className="container">
          <PlanLock feature="pos" unlocksWith={unlocks?.plan ?? "servicio"} />
        </div>
      </div>
    );
  }

  // The till shows what has run out; the diner's menu never does.
  const data = await loadOrderingData(membership.restaurant.id, { includeSoldOut: true });
  if (!data.restaurant) redirect("/dashboard");

  return (
    <PosScreen
      restaurant={data.restaurant}
      categories={data.categories}
      items={data.items}
      extras={data.extras}
      extrasByProduct={data.extrasByProduct}
      promos={data.promos}
      combos={data.combos}
      closedNow={data.closedNow}
      dietaryTags={data.dietaryTags}
      canEmailReceipt={data.receipts}
    />
  );
}
