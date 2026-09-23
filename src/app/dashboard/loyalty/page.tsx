import { requireManager } from "@/lib/page-guard";
import { allPlans, getPlan } from "@/lib/plan-server";
import { can, cheapestWith } from "@/lib/plan";
import { programOf } from "@/lib/loyalty/server";
import PlanLock from "@/components/dashboard/plan/PlanLock";
import LoyaltyAdmin from "@/components/dashboard/loyalty/LoyaltyAdmin";

export const dynamic = "force-dynamic";

/**
 * /dashboard/loyalty — the visit card, for the owner and the managers: whether
 * it runs, how many visits earn what, and any card looked up with every visit
 * and who stamped it. On a tier without the card this names the tier that has
 * it, rather than showing settings the routes would refuse.
 */
export default async function LoyaltyPage() {
  const membership = await requireManager();
  const r = membership.restaurant;
  const plan = await getPlan(r.id);

  if (!plan || !can(plan.limits, "loyalty")) {
    const unlocks = cheapestWith(await allPlans(), "loyalty");
    return (
      <div className="tt-dash">
        <div className="container">
          <PlanLock feature="loyalty" unlocksWith={unlocks?.plan ?? "casa"} />
        </div>
      </div>
    );
  }

  const program = await programOf(r.id);
  return <LoyaltyAdmin program={program ?? { active: false, goal: 8, reward: "" }} />;
}
