import { createClient } from "@/lib/supabase/server";
import OrdersBoard from "@/components/dashboard/OrdersBoard";
import LoginForm from "@/components/dashboard/LoginForm";
import type { Order, Restaurant } from "@/lib/types";

export const dynamic = "force-dynamic";

// /dashboard — restaurant staff view. Requires login.
export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <LoginForm />;
  }

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
        <p>
          Set <code>owner_id</code> on a row in the <code>restaurants</code> table to your
          user id (<code>{user.id}</code>) in the Supabase dashboard, then refresh.
        </p>
      </div>
    );
  }

  const { data: orders } = await supabase
    .from("orders")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .neq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <OrdersBoard
      restaurant={restaurant as Restaurant}
      initialOrders={(orders as Order[]) ?? []}
    />
  );
}
