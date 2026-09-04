import { createAdminClient } from "@/lib/supabase/admin";
import { MANAGES, OWNS, SETTLES } from "@/lib/membership";
import { requireSettles } from "@/lib/page-guard";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import BillsPanel from "@/components/dashboard/BillsPanel";
import UserLogs from "@/components/dashboard/staff/UserLogs";
import { openBills, withSplits } from "@/lib/open-bills";
import { currentUser } from "@/lib/current-user";
import { startOfLocalDay } from "@/lib/day-window";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { EMPTY_TILL, tillFrom } from "@/lib/till";
import TillCard from "@/components/dashboard/TillCard";
import type { Order } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * /dashboard/bills — every bill still open, so the floor can find one.
 *
 * A manager is asked for a discount by name of the table, not by order id, so
 * this lists tables and to-go orders with what they owe and lets them be
 * searched. The kitchen has no business here; everyone else on the floor does,
 * because a waiter can ask for a discount even though only a manager grants it.
 */
export default async function BillsPage() {
  const membership = await requireSettles();
  const r = membership.restaurant;

  // Read with the secret key: orders are unreadable to anyone but the team's
  // own policies, and this page needs every table's, not just one's.
  const db = createAdminClient();
  const [{ data: orders }, { data: requests }, { data: writeOffs }, { data: asking }] =
    await Promise.all([
    db
      .from("orders")
      .select(
        "id, session_id, table_id, table_label, items, total, discount, paid, written_off, status, coupon_code, customer_name, created_at",
      )
      .eq("restaurant_id", r.id)
      .eq("paid", false)
      .neq("status", "pending_payment")
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("discount_requests")
      .select("*")
      .eq("restaurant_id", r.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    db
      .from("write_off_requests")
      .select("*")
      .eq("restaurant_id", r.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    // Who asked for the bill: these are the tables waiting for somebody to come
    // and collect, which is not the same as having a balance.
    db
      .from("service_requests")
      .select("table_id")
      .eq("restaurant_id", r.id)
      .in("kind", ["bill", "pay"])
      .eq("status", "open"),
  ]);

  // Their own takings, read here with the secret key rather than by widening
  // the log's policy. `user_logs` is the owner's to read, and it stays that
  // way: the filter below is the session's own email, so nobody sees anybody
  // else's collections and no new door was opened to get there.
  const me = await currentUser();
  const dayStart = startOfLocalDay(new Date(), r.timezone ?? DEFAULT_TIME_ZONE);
  const { data: myPayments } = me?.email
    ? await db
        .from("user_logs")
        .select("detail")
        .eq("restaurant_id", r.id)
        .eq("actor_email", me.email)
        .eq("entity", "bill")
        .eq("action", "paid")
        .gte("created_at", dayStart.toISOString())
    : { data: null };
  const till = myPayments ? tillFrom(myPayments) : EMPTY_TILL;

  // Tables part-way through dividing their bill, and what has already come in.
  // A share is money against the sitting rather than any order, so without this
  // the floor would see the whole amount still owing and could take it again.
  // The select asks for the columns the screen needs, which is fewer than an
  // Order has — so the row shape is named here rather than asserted into one.
  type BillRow = Order & { session_id?: string | null };
  const rows = (orders ?? []) as unknown as BillRow[];
  const sessionOf = new Map(
    rows.filter(o => o.session_id).map(o => [o.id, o.session_id as string]),
  );
  const { data: liveSplits } = await db
    .from("bill_splits")
    .select("id, session_id, shares, bill_split_claims(paid_at, amount)")
    .eq("restaurant_id", r.id)
    .eq("status", "locked");

  type LiveSplit = {
    session_id: string;
    shares: number;
    bill_split_claims: { paid_at: string | null; amount: number }[] | null;
  };
  const splits = ((liveSplits ?? []) as unknown as LiveSplit[]).map(s => {
    const claims = s.bill_split_claims ?? [];
    const settled = claims.filter(c => c.paid_at);
    return {
      session_id: s.session_id,
      shares: s.shares,
      paidShares: settled.length,
      collected: settled.reduce((sum, c) => sum + Number(c.amount), 0),
    };
  });

  return (
    <ConfirmProvider>
      <BillsPanel
        bills={withSplits(openBills(rows as Order[]), splits, sessionOf)}
        requests={MANAGES(membership.role) ? (requests ?? []) : []}
        writeOffs={MANAGES(membership.role) ? (writeOffs ?? []) : []}
        currency={r.currency}
        canApprove={MANAGES(membership.role)}
        restaurantId={r.id}
        canSettle={SETTLES(membership.role)}
        askedToPay={(asking ?? []).map(a => a.table_id).filter(Boolean) as string[]}
      >
        {/* Owner only, because that is all the database will hand over: the
            policy on `user_logs` is `owns_restaurant`. Showing it to a manager
            meant the gate said yes and the database returned zero — the manager
            opened "Actividad reciente" with its search box, its sort buttons
            and an empty list, and left thinking the log was broken.

            The policy is not widened to match: the log also carries staff
            hires, removals and role changes, and a manager does not reach
            /dashboard/staff. */}
        {/* Above the log, because counting your own drawer is a thing you do
            at the end of a shift and the log is a thing you read afterwards. */}
        <TillCard till={till} currency={r.currency} />
        {OWNS(membership.role) && (
          <UserLogs restaurantId={r.id} currency={r.currency} />
        )}
      </BillsPanel>
    </ConfirmProvider>
  );
}
