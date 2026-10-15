import { requireManager } from "@/lib/page-guard";
import { allPlans, getPlan } from "@/lib/plan-server";
import { can, cheapestWith } from "@/lib/plan";
import { readCosts } from "@/lib/costs/server";
import { readStock } from "@/lib/costs/stock-server";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import Breadcrumb from "@/components/layout/Breadcrumb";
import PlanLock from "@/components/dashboard/plan/PlanLock";
import CostsView, { COSTS_TABS, type CostsTab } from "@/components/dashboard/costs/CostsView";
import MarginsPanel from "@/components/dashboard/costs/MarginsPanel";
import IngredientsPanel from "@/components/dashboard/costs/IngredientsPanel";
import WastePanel from "@/components/dashboard/costs/WastePanel";
import StockPanel from "@/components/dashboard/costs/StockPanel";
import BuyPanel from "@/components/dashboard/costs/BuyPanel";

export const dynamic = "force-dynamic";

/**
 * /dashboard/costs — what each product leaves, the ingredients behind it,
 * what was thrown away, what the shelf should hold and what to buy. The owner
 * and the managers; on a tier without it, the page names the tier that has it
 * and offers nothing the routes would refuse.
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

  const asked = (await searchParams).tab;
  const tab: CostsTab = COSTS_TABS.includes(asked as CostsTab) ? (asked as CostsTab) : "margins";
  const currency = r.currency;
  let panel: React.ReactNode;
  if (tab === "margins" || tab === "ingredients") {
    const view = await readCosts(r.id);
    panel = tab === "margins"
      ? <MarginsPanel view={view} currency={currency} />
      : <IngredientsPanel ingredients={view.ingredients} recipes={view.recipes} currency={currency} />;
  } else {
    const stock = await readStock(r.id);
    const timeZone = r.timezone ?? undefined;
    panel = tab === "waste"
      ? <WastePanel stock={stock} currency={currency} timeZone={timeZone} />
      : tab === "stock"
        ? <StockPanel stock={stock} currency={currency} timeZone={timeZone} />
        : <BuyPanel stock={stock} currency={currency} timeZone={timeZone} />;
  }
  return (
    <ConfirmProvider>
      <CostsView tab={tab}>{panel}</CostsView>
    </ConfirmProvider>
  );
}
