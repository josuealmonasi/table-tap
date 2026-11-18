import { createAdminClient } from "@/lib/supabase/admin";
import { allPlans } from "@/lib/plan-server";

/** A plan's price as the admin sees it, with any change still to come. */
export interface AdminPlanPrice {
  plan: string;
  monthlyPrice: number;
  pending: { id: string; newPrice: number; effectiveAt: string; queued: number; sent: number } | null;
}

/**
 * Every paid plan's catalogue price and its next scheduled change, with how
 * many owners are queued for the notice and how many were already told.
 * Carta is free and never changes price, so it is left out.
 */
export async function adminPlanPrices(): Promise<AdminPlanPrice[]> {
  const db = createAdminClient();
  const [plans, changesRes] = await Promise.all([
    allPlans(),
    db.from("plan_price_changes").select("id, plan, new_monthly_price, effective_at, plan_price_notices(sent_at)")
      .is("applied_at", null).order("effective_at"),
  ]);
  if (changesRes.error) throw new Error(`Price changes read failed: ${changesRes.error.message}`);
  const changes = (changesRes.data ?? []) as { id: string; plan: string; new_monthly_price: number; effective_at: string; plan_price_notices: { sent_at: string | null }[] }[];
  return plans.filter(p => p.plan !== "carta").map(p => {
    const next = changes.find(c => c.plan === p.plan);
    return {
      plan: p.plan,
      monthlyPrice: Number(p.monthly_price),
      pending: next ? {
        id: next.id, newPrice: Number(next.new_monthly_price), effectiveAt: next.effective_at,
        queued: next.plan_price_notices.length, sent: next.plan_price_notices.filter(n => n.sent_at).length,
      } : null,
    };
  });
}
