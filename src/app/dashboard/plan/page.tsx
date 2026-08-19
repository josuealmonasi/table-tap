import { redirect } from "next/navigation";
import { getMembership } from "@/lib/membership";
import { createAdminClient } from "@/lib/supabase/admin";
import { allPlans, getPlan } from "@/lib/plan-server";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import PlanPanel from "@/components/dashboard/plan/PlanPanel";

export const dynamic = "force-dynamic";

/** What the ceilings are measured against, counted the way the triggers count. */
async function usageFor(restaurantId: string) {
  const db = createAdminClient();
  const count = async (table: string, addonFilter = false) => {
    let q = db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId);
    // Add-ons ride along with their product and are not counted as dishes —
    // the same rule the insert trigger follows.
    if (addonFilter) q = q.eq("is_addon", false);
    return (await q).count ?? 0;
  };

  const [tables, staff, menus, items] = await Promise.all([
    count("restaurant_tables"),
    count("staff"),
    count("menus"),
    count("menu_items", true),
  ]);
  return { tables, staff, menus, items };
}

// /dashboard/plan — the subscription. Owner only: a manager runs the
// restaurant, but the card is not theirs to change.
export default async function PlanPage() {
  const membership = await getMembership();
  if (!membership) redirect("/login");
  if (membership.role !== "owner") redirect("/dashboard");

  const [plan, catalog, usage, billing, founders] = await Promise.all([
    getPlan(membership.restaurant.id),
    allPlans(),
    usageFor(membership.restaurant.id),
    // Whether there is anything to manage yet. A restaurant on the free tier
    // or still inside its trial has no Stripe customer, and a button that
    // opens an error is worse than no button.
    createAdminClient()
      .from("restaurants")
      .select("stripe_customer_id, terms_version, terms_accepted_at, founding_number, subscribed_price")
      .eq("id", membership.restaurant.id)
      .single(),
    // Cuántos lugares de fundador se han tomado ya.
    createAdminClient()
      .from("restaurants")
      .select("id", { count: "exact", head: true })
      .not("founding_number", "is", null),
  ]);
  if (!plan) redirect("/dashboard");

  // ConfirmProvider because cancelling asks before it ends anything — the
  // same wrapper Settings and Promotions use for their destructive actions.
  return (
    <ConfirmProvider>
      <PlanPanel
        plan={plan}
        catalog={catalog}
        usage={usage}
        hasBilling={Boolean(billing.data?.stripe_customer_id)}
        acceptedVersion={billing.data?.terms_version ?? null}
        acceptedAt={billing.data?.terms_accepted_at ?? null}
        currency={membership.restaurant.currency}
        foundingNumber={billing.data?.founding_number ?? null}
        foundersTaken={founders.count ?? 0}
        subscribedPrice={billing.data?.subscribed_price ?? null}
      />
    </ConfirmProvider>
  );
}
