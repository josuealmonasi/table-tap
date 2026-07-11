import { redirect } from "next/navigation";
import { getPlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
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
  const [
    { data: restaurants },
    { data: staff },
    { data: admins },
    { data: profiles },
    users,
  ] = await Promise.all([
    db
      .from("restaurants")
      .select("id, name, logo, owner_id, created_at")
      .order("created_at"),
    db.from("staff").select("user_id, restaurant_id, role"),
    db.from("platform_admins").select("user_id"),
    db.from("profiles").select("user_id, full_name"),
    db.auth.admin.listUsers({ perPage: 1000 }),
  ]);

  const restaurantById = new Map((restaurants ?? []).map(r => [r.id, r]));
  const staffByUser = new Map((staff ?? []).map(s => [s.user_id, s]));
  const adminIds = new Set((admins ?? []).map(a => a.user_id));
  const nameByUser = new Map((profiles ?? []).map(p => [p.user_id, p.full_name]));
  const foundingByUser = new Map((restaurants ?? []).map(r => [r.owner_id, r]));
  const emailByUser = new Map(users.data.users.map(u => [u.id, u.email ?? "—"]));

  const userRows: AdminUserRow[] = users.data.users
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
        restaurant_name: restaurant?.name,
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email));

  const staffCounts = new Map<string, number>();
  for (const s of staff ?? []) {
    staffCounts.set(s.restaurant_id, (staffCounts.get(s.restaurant_id) ?? 0) + 1);
  }
  const restaurantRows: AdminRestaurantRow[] = (restaurants ?? []).map(r => ({
    id: r.id,
    name: `${r.logo ?? "🍱"} ${r.name}`,
    owner_email: r.owner_id ? (emailByUser.get(r.owner_id) ?? "—") : "—",
    team_count: staffCounts.get(r.id) ?? 0,
    created_at: r.created_at,
  }));

  const restaurantOptions = (restaurants ?? []).map(r => ({ id: r.id, name: r.name }));

  return (
    <ConfirmProvider>
      <AdminPanel
        adminUserId={admin.userId}
        restaurants={restaurantRows}
        users={userRows}
        restaurantOptions={restaurantOptions}
      />
    </ConfirmProvider>
  );
}
