import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/membership";
import OrdersBoard from "@/components/dashboard/OrdersBoard";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import type { Order, ServiceRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

// /dashboard/orders — live kitchen board for the owner AND their staff.
// Orders are read via the member-scoped server client (works_at RLS); the
// board keeps them live via realtime. Cancelling (refunds) stays owner-only.
export default async function OrdersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getMembership(supabase);
  if (!membership) redirect("/dashboard");
  const r = membership.restaurant;

  // Seed the board with recent paid orders (unpaid/pending ones never show).
  const { data: orders } = await supabase
    .from("orders")
    .select("*")
    .eq("restaurant_id", r.id)
    .neq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(100);

  const { data: requests } = await supabase
    .from("service_requests")
    .select("*")
    .eq("restaurant_id", r.id)
    .eq("status", "open")
    .order("created_at", { ascending: false });

  return (
    <ConfirmProvider>
      <OrdersBoard
        restaurant={r}
        initialOrders={(orders as Order[]) ?? []}
        initialRequests={(requests as ServiceRequest[]) ?? []}
        canCancel={membership.role === "owner"}
      />
    </ConfirmProvider>
  );
}
