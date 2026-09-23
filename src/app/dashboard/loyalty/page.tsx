import { requireManager } from "@/lib/page-guard";
import { allPlans, getPlan } from "@/lib/plan-server";
import { can, cheapestWith } from "@/lib/plan";
import { programOf } from "@/lib/loyalty/server";
import PlanLock from "@/components/dashboard/plan/PlanLock";
import LoyaltyAdmin from "@/components/dashboard/loyalty/LoyaltyAdmin";
import { headers } from "next/headers";
import { cardFace } from "@/lib/loyalty/face";
import { qrGrid } from "@/lib/loyalty/qr-grid";

/** Twelve zeros: a valid code that no card has, so the preview is plainly a sample. */
const SAMPLE_CODE = "000000000000";

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

  const program = (await programOf(r.id)) ?? { active: false, goal: 8, reward: "", steps: [{ visits: 8, reward: "" }] };

  // The card as a diner gets it, drawn on the owner's screen from a sample
  // code. Built here so the QR library stays on the server, as it does for
  // the diner. Until every step has its reward there is nothing to show on it.
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const face = program.steps.every(s => s.reward.trim())
    ? cardFace(
        { name: r.name, logo: r.logo ?? null, logo_url: r.logo_url ?? null },
        { code: SAMPLE_CODE, progress: 0, ladder: program.steps },
        `${proto}://${host}`,
      )
    : null;
  const preview = face ? { face, qr: qrGrid(face.qrPayload) } : null;

  return <LoyaltyAdmin program={program} preview={preview} />;
}
