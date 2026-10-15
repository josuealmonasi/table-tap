import { requireManager } from "@/lib/page-guard";
import { allPlans, getPlan } from "@/lib/plan-server";
import { can, cheapestWith } from "@/lib/plan";
import { readCosts } from "@/lib/costs/server";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import Breadcrumb from "@/components/layout/Breadcrumb";
import PlanLock from "@/components/dashboard/plan/PlanLock";
import CostsView, { type CostsTab } from "@/components/dashboard/costs/CostsView";

export const dynamic = "force-dynamic";

/**
 * /dashboard/costs — what each product leaves: its recipe, what the
 * ingredients cost, and what taking the money cost. The owner and the
 * managers; on a tier without it, the page names the tier that has it and
 * offers nothing the routes would refuse.
 */
export default async function CostsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const membership = await requireManager();
  const r = membership.restaurant;
  const plan = await getPlan(r.id);

  if (!plan || !can(plan.limits, "costs")) {
    const unlocks = cheapestWith(await allPlans(), "costs", plan?.limits);
    return (
      <div className="tt-dash">
        <div className="container">
          <header className="tt-dash-head">
            <Breadcrumb trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.costs" }]} />
          </header>
          <PlanLock feature="costs" unlocksWith={unlocks?.plan ?? "casa"} isOwner={membership.role === "owner"} />
        </div>
      </div>
    );
  }

  const tab: CostsTab = (await searchParams).tab === "ingredients" ? "ingredients" : "margins";
  const view = await readCosts(r.id);
  return (
    <ConfirmProvider>
      <CostsView view={view} tab={tab} currency={r.currency} />
    </ConfirmProvider>
  );
}
