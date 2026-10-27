import { redirect } from "next/navigation";
import { STALE_REQUEST_HOURS } from "@/lib/service-requests";
import { createClient } from "@/lib/supabase/server";
import { getMembership, MANAGES, MOVES_ORDERS, SETTLES, TAKES_COUNTER_ORDERS } from "@/lib/membership";
import { getPlan } from "@/lib/plan-server";
import { can, planLabel } from "@/lib/plan";
import { getLocale } from "@/lib/i18n/server";
import { messagesFor, translate } from "@/lib/i18n";
import { SecureIcon } from "@/components/ui/icons";
import OrdersBoard from "@/components/dashboard/OrdersBoard";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { currentUser } from "@/lib/current-user";
import { startOfLocalDay } from "@/lib/day-window";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import type { BoardOrder, BoardRequest } from "@/lib/kitchen-ticket";
import { LIVE_FLOW } from "@/lib/order-flow";
import { collectedToday } from "@/lib/collected-today";

export const dynamic = "force-dynamic";

// /dashboard/orders — live kitchen board for the owner AND their staff.
// The member-scoped client reads tickets for the kitchen and full orders for
// the floor. Each feed stays live via realtime; refunds stay owner-only.
export default async function OrdersPage() {
  const supabase = await createClient();
  const user = await currentUser();
  if (!user) redirect("/login");

  const membership = await getMembership();
  if (!membership) redirect("/dashboard");
  const r = membership.restaurant;
  const kitchen = membership.role === "kitchen";

  // No board on Caja: a sale is served where it is paid. Everything that sends
  // staff "home" sends them here, so it goes on to the register rather than
  // to a lock — the till is what they came to work at.
  const plan = await getPlan(r.id);
  if (plan && !can(plan.limits, "kitchenBoard")) {
    if (TAKES_COUNTER_ORDERS(membership.role)) redirect("/dashboard/pos");
    // A kitchen or waiter login kept through a move down to Caja. This used to
    // send it to /dashboard, which sends every role that does not manage
    // straight back here: the browser bounced between the two for as long as
    // it was let, and the person saw an empty frame and no reason.
    const m = messagesFor(await getLocale());
    const name = planLabel(plan.limits.plan);
    return (
      <div className="tt-dash">
        <div className="container">
          <div className="tt-section tt-plan-lock">
            <div className="tt-plan-lock-body">
              <SecureIcon size={20} weight="bold" aria-hidden="true" />
              <div>
                <strong>{translate(m, "plan.noScreenTitle", { plan: name })}</strong>
                <p className="tt-muted">{translate(m, "plan.noScreenBody", { plan: name })}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Only today's shift. A request nobody ever pressed "done" on stays open
  // forever, so the board was carrying taps from weeks earlier — a chip asking
  // for a waiter at a table that emptied on Tuesday teaches the floor to
  // ignore the row. A diner still waiting will tap again.
  const shiftStart = new Date(Date.now() - STALE_REQUEST_HOURS * 60 * 60 * 1000);

  // Today's takings: what arrived in the ledger since the restaurant's
  // midnight, net of what went back, the same figure the corte signs for.
  // The restaurant's midnight, not the host's. On a UTC server this line used
  // to start "today" at six the previous evening for a Mexico City kitchen —
  // so the takings on the board carried half of last night and dropped
  // tonight's dinner service into tomorrow.
  const todayStart = startOfLocalDay(new Date(), r.timezone ?? DEFAULT_TIME_ZONE);
  const showRevenue = MANAGES(membership.role);

  // All three in the same wave: none needs another's result, only the
  // restaurant id and its midnight, which we already have. In a row they were
  // three round trips with the kitchen waiting in front of the screen.
  // The day's till figure is still skipped when the viewer cannot see it.
  let liveOrders = supabase
    .from(kitchen ? "kitchen_tickets" : "orders")
    .select("*")
    .eq("restaurant_id", r.id)
    .in("status", LIVE_FLOW)
    .order("created_at", { ascending: false });
  if (!kitchen) liveOrders = liveOrders.eq("written_off", false);

  const [ordersRes, requestsRes, collected, barRes] = await Promise.all([
    // Every order still on the board, however many came after it. This was
    // the newest 100 of ANY status, filtered to the live ones afterwards — so
    // after a busy stretch an order the kitchen had not started was simply not
    // loaded, while the Pedidos badge, which counts by status, went on
    // counting it. History pages through the rest on its own.
    liveOrders,
    supabase
      .from(kitchen ? "kitchen_requests" : "service_requests")
      .select("*")
      .eq("restaurant_id", r.id)
      .eq("status", "open")
      .gte("created_at", shiftStart.toISOString())
      .order("created_at", { ascending: false }),
    // Money, not orders: a partial collection, a split share and an old
    // account settled today never make a paid order created today.
    showRevenue ? collectedToday(r.id, r.currency, todayStart) : Promise.resolve(0),
    // Whether anything is made at the bar: only then does the board offer
    // its stations. A restaurant with one kitchen sees the board it always had.
    supabase
      .from("categories")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", r.id)
      .eq("station", "bar"),
  ]);
  const orders = ordersRes.data;
  const requests = requestsRes.data;

  return (
    <ConfirmProvider>
      <OrdersBoard
        restaurant={{ id: r.id, currency: r.currency }}
        initialOrders={(orders as BoardOrder[]) ?? []}
        kitchen={kitchen}
        initialRequests={(requests as BoardRequest[]) ?? []}
        canCancel={MANAGES(membership.role)}
        canMove={MOVES_ORDERS(membership.role)}
        canSettle={SETTLES(membership.role)}
        isWaiter={membership.role === "waiter"}
        canApprove={MANAGES(membership.role)}
        showRevenue={showRevenue}
        collectedToday={collected}
        hasStations={(barRes.count ?? 0) > 0}
      />
    </ConfirmProvider>
  );
}
