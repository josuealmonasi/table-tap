import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/membership";
import { getPlatformAdmin } from "@/lib/admin";
import DashboardHome from "@/components/dashboard/DashboardHome";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";

export const dynamic = "force-dynamic";

// /dashboard — the owner's home. Staff go straight to the orders board.
export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  if (await getPlatformAdmin()) redirect("/dashboard/admin");

  const membership = await getMembership(supabase);
  if (membership?.role === "kitchen") redirect("/dashboard/orders");

  if (!membership) {
    return (
      <div style={{ padding: 40, fontFamily: "system-ui" }}>
        <h2>No restaurant linked to this account</h2>
        <p className="tt-muted">
          This account ({user.email}) has no restaurant yet. This normally can&apos;t
          happen via sign-up — contact support or create a new account.
        </p>
      </div>
    );
  }

  return (
    <ConfirmProvider>
      <DashboardHome restaurant={membership.restaurant} role={membership.role} />
    </ConfirmProvider>
  );
}
