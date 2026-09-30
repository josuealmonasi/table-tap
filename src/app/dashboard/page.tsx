import { redirect } from "next/navigation";
import { getMembership, MANAGES } from "@/lib/membership";
import { getPlatformAdmin } from "@/lib/admin";
import DashboardHome from "@/components/dashboard/DashboardHome";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { getLocale } from "@/lib/i18n/server";
import { messagesFor, translate } from "@/lib/i18n";
import { currentUser } from "@/lib/current-user";
import { allPlans, getPlan } from "@/lib/plan-server";
import { can, cheapestWith } from "@/lib/plan";

export const dynamic = "force-dynamic";

// /dashboard — the owner's home. Staff go straight to the orders board.
export default async function DashboardPage() {
  const user = await currentUser();

  if (!user) redirect("/login");

  if (await getPlatformAdmin()) redirect("/dashboard/admin");

  const membership = await getMembership();
  if (membership && !MANAGES(membership.role)) redirect("/dashboard/orders");

  if (!membership) {
    const m = messagesFor(await getLocale());
    return (
      <div style={{ padding: 40, fontFamily: "system-ui" }}>
        <h2>{translate(m, "landing.noRestaurant")}</h2>
        <p className="tt-muted">
          {translate(m, "landing.noRestaurantMsg", { email: user.email ?? "" })}
        </p>
      </div>
    );
  }

  // Decided here, on the server: the database refuses a new schedule on a
  // tier without them, so the editor must not be offered there.
  const [plan, catalog] = await Promise.all([getPlan(membership.restaurant.id), allPlans()]);
  const schedules = {
    allowed: plan ? can(plan.limits, "menuSchedules") : false,
    unlocksWith: cheapestWith(catalog, "menuSchedules", plan?.limits)?.plan ?? "casa",
    isOwner: membership.role === "owner",
  };

  return (
    <ConfirmProvider>
      <DashboardHome restaurant={membership.restaurant} role={membership.role} schedules={schedules} />
    </ConfirmProvider>
  );
}
