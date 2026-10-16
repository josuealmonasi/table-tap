import { everyRow } from "@/lib/paged";
import { everyLogin } from "@/lib/logins";
import { redirect } from "next/navigation";
import { getPlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { allPlans } from "@/lib/plan-server";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import AdminPanel, {
  type AdminRestaurantRow,
  type AdminUserRow,
} from "@/components/dashboard/admin/AdminPanel";

export const dynamic = "force-dynamic";

// /dashboard/admin — the platform view: every restaurant and every login.
// Guarded by platform_admins (server-only table); everyone else bounces.
export default async function AdminPage() {
  const admin = await getPlatformAdmin();
  if (!admin) redirect("/dashboard");

  const db = createAdminClient();
  // Every row of each, paged: these grow with the platform, and a read that
  // stopped at the server's thousand rows showed owners as nobody and teams
  // as empty. A failed read throws, like every dashboard page — a failed read
  // here showed no restaurants and no logins on the one page that manages
  // logins — and the error screen offers a retry instead.
  const [restaurants, staff, admins, profiles, logins] = await Promise.all([
    everyRow<{ id: string; name: string; logo: string | null; owner_id: string | null; created_at: string; plan: string; stripe_subscription_id: string | null }>(
      (a, b) => db.from("restaurants")
        .select("id, name, logo, owner_id, created_at, plan, stripe_subscription_id")
        .order("created_at").order("id").range(a, b),
      "the restaurants",
    ),
    everyRow<{ user_id: string; restaurant_id: string; role: string }>(
      (a, b) => db.from("staff").select("user_id, restaurant_id, role").order("id").range(a, b),
      "the teams",
    ),
    everyRow<{ user_id: string }>(
      (a, b) => db.from("platform_admins").select("user_id").order("user_id").range(a, b),
      "the platform admins",
    ),
    everyRow<{ user_id: string; full_name: string | null }>(
      (a, b) => db.from("profiles").select("user_id, full_name").order("user_id").range(a, b),
      "the names",
    ),
    everyLogin(db),
  ]);

  const restaurantById = new Map(restaurants.map(r => [r.id, r]));
  const staffByUser = new Map(staff.map(s => [s.user_id, s]));
  const adminIds = new Set(admins.map(a => a.user_id));
  const nameByUser = new Map(profiles.map(p => [p.user_id, p.full_name]));
  const foundingByUser = new Map(restaurants.map(r => [r.owner_id, r]));
  const emailByUser = new Map(logins.map(u => [u.id, u.email ?? "—"]));

  const userRows: AdminUserRow[] = logins
    .map(u => {
      const membership = staffByUser.get(u.id);
      const founded = foundingByUser.get(u.id);
      const role = adminIds.has(u.id)
        ? "admin"
        : founded
          ? "owner"
          : ((membership?.role as AdminUserRow["role"] | undefined) ?? "none");
      const restaurant =
        founded ??
        (membership ? restaurantById.get(membership.restaurant_id) : undefined);
      return {
        user_id: u.id,
        email: u.email ?? "—",
        full_name: nameByUser.get(u.id) || undefined,
        role,
        founding: !!founded,
        restaurant_name: restaurant?.name,
        plan: restaurant?.plan as string | undefined,
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email));

  const staffCounts = new Map<string, number>();
  for (const s of staff) {
    staffCounts.set(s.restaurant_id, (staffCounts.get(s.restaurant_id) ?? 0) + 1);
  }
  const restaurantRows: AdminRestaurantRow[] = restaurants.map(r => ({
    id: r.id,
    name: `${r.logo ?? "🍱"} ${r.name}`,
    owner_email: r.owner_id ? (emailByUser.get(r.owner_id) ?? "—") : "—",
    team_count: staffCounts.get(r.id) ?? 0,
    plan: r.plan as string,
    billed_by_stripe: Boolean(r.stripe_subscription_id),
    created_at: r.created_at,
  }));

  const restaurantOptions = restaurants.map(r => ({ id: r.id, name: r.name }));

  return (
    <ConfirmProvider>
      <AdminPanel
        adminUserId={admin.userId}
        restaurants={restaurantRows}
        users={userRows}
        restaurantOptions={restaurantOptions}
        plans={(await allPlans()).map(p => p.plan)}
      />
    </ConfirmProvider>
  );
}
