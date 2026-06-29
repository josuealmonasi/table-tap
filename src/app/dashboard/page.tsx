import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardHome from "@/components/dashboard/DashboardHome";

export const dynamic = "force-dynamic";

// /dashboard — restaurant staff view. Requires login.
export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Load the restaurant this user owns.
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("*")
    .eq("owner_id", user.id)
    .single();

  if (!restaurant) {
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

  return <DashboardHome />;
}
