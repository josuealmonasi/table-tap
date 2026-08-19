import { redirect } from "next/navigation";
import { STALE_REQUEST_HOURS } from "@/lib/service-requests";
import { createClient } from "@/lib/supabase/server";
import { getMembership, MANAGES, MOVES_ORDERS, SETTLES } from "@/lib/membership";
import OrdersBoard from "@/components/dashboard/OrdersBoard";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import type { Order, ServiceRequest } from "@/lib/types";
import { currentUser } from "@/lib/current-user";
import { startOfLocalDay } from "@/lib/day-window";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";

export const dynamic = "force-dynamic";

// /dashboard/orders — live kitchen board for the owner AND their staff.
// Orders are read via the member-scoped server client (works_at RLS); the
// board keeps them live via realtime. Cancelling (refunds) stays owner-only.
export default async function OrdersPage() {
  const supabase = await createClient();
  const user = await currentUser();
  if (!user) redirect("/login");

  const membership = await getMembership();
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

  // Only today's shift. A request nobody ever pressed "done" on stays open
  // forever, so the board was carrying taps from weeks earlier — a chip asking
  // for a waiter at a table that emptied on Tuesday teaches the floor to
  // ignore the row. A diner still waiting will tap again.
  const shiftStart = new Date(Date.now() - STALE_REQUEST_HOURS * 60 * 60 * 1000);
  const { data: requests } = await supabase
    .from("service_requests")
    .select("*")
    .eq("restaurant_id", r.id)
    .eq("status", "open")
    .gte("created_at", shiftStart.toISOString())
    .order("created_at", { ascending: false });

  // Today's takings, computed server-side over ALL of today's orders (the
  // board only loads the latest 100, so summing those undercounts a busy day).
  // We pass a "base" — today's total minus what's in the loaded set — so the
  // board can add its live, realtime-updating slice on top without double
  // counting. Both sides use the same day boundary (todayStartMs).
  // The restaurant's midnight, not the host's. On a UTC server this line used
  // to start "today" at six the previous evening for a Mexico City kitchen —
  // so the takings on the board carried half of last night and dropped
  // tonight's dinner service into tomorrow.
  const todayStart = startOfLocalDay(new Date(), r.timezone ?? DEFAULT_TIME_ZONE);
  const showRevenue = MANAGES(membership.role);

  let revenueBase = 0;
  if (showRevenue) {
    const { data: todayRows } = await supabase
      .from("orders")
      .select("total")
      .eq("restaurant_id", r.id)
      .eq("paid", true)
      .neq("status", "cancelled")
      .gte("created_at", todayStart.toISOString());
    const todayTotal = (todayRows ?? []).reduce((s, o) => s + Number(o.total), 0);
    const loadedToday = ((orders as Order[]) ?? [])
      .filter(
        o =>
          o.paid &&
          o.status !== "cancelled" &&
          new Date(o.created_at).getTime() >= todayStart.getTime(),
      )
      .reduce((s, o) => s + Number(o.total), 0);
    revenueBase = +(todayTotal - loadedToday).toFixed(2);
  }

  return (
    <ConfirmProvider>
      <OrdersBoard
        restaurant={r}
        initialOrders={(orders as Order[]) ?? []}
        initialRequests={(requests as ServiceRequest[]) ?? []}
        canCancel={MANAGES(membership.role)}
        canMove={MOVES_ORDERS(membership.role)}
        canSettle={SETTLES(membership.role)}
        canApprove={MANAGES(membership.role)}
        showRevenue={showRevenue}
        revenueBase={revenueBase}
        todayStartMs={todayStart.getTime()}
      />
    </ConfirmProvider>
  );
}
