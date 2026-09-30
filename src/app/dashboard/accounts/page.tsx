import { redirect } from "next/navigation";
import { getMembership, KEEPS_ACCOUNTS, MANAGES } from "@/lib/membership";
import { allPlans, getPlan } from "@/lib/plan-server";
import { can, cheapestWith } from "@/lib/plan";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import AccountsPanel from "@/components/dashboard/accounts/AccountsPanel";

export const dynamic = "force-dynamic";

// /dashboard/accounts — customer accounts, for everyone who takes money. The
// kitchen has no business with who owes what.
export default async function AccountsPage() {
  const membership = await getMembership();
  if (!membership) redirect("/login");
  if (!KEEPS_ACCOUNTS(membership.role)) redirect("/dashboard/orders");

  const r = membership.restaurant;
  const [plan, catalog] = await Promise.all([getPlan(r.id), allPlans()]);
  const canOpen = plan ? can(plan.limits, "openAccounts") : false;

  return (
    <ConfirmProvider>
      <AccountsPanel
        currency={r.currency}
        timeZone={r.timezone ?? DEFAULT_TIME_ZONE}
        canOpen={canOpen}
        unlocksWith={cheapestWith(catalog, "openAccounts", plan?.limits)?.plan ?? "caja"}
        isOwner={membership.role === "owner"}
        canManage={MANAGES(membership.role)}
      />
    </ConfirmProvider>
  );
}
