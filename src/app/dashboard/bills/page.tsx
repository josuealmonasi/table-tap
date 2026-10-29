import PaymentAttribution from "@/components/dashboard/PaymentAttribution";
import OrderRefunds from "@/components/dashboard/OrderRefunds";
import { orderRefunds } from "@/lib/refunds/operations";
import { paymentCoverage } from "@/lib/payment-coverage";
import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { unwrap } from "@/lib/ordering-data";
import { MANAGES, OWNS, SETTLES } from "@/lib/membership";
import { getPlan } from "@/lib/plan-server";
import { loyaltyOn } from "@/lib/loyalty/server";
import { can } from "@/lib/plan";
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
import RefundsDue from "@/components/dashboard/RefundsDue";
import { refundsDue } from "@/lib/refunds/due-list";
import type { Order } from "@/lib/types";
import { billRequestCurrencies } from "@/lib/bill-request-currency";

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
  const plan = await getPlan(r.id);

  // Read with the secret key: orders are unreadable to anyone but the team's
  // own policies, and this page needs every table's, not just one's.
  const db = createAdminClient();
  const [ordersRes, requestsRes, writeOffsRes, askingRes] =
    await Promise.all([
    db
      .from("orders")
      .select(
        "id, session_id, table_id, table_label, currency, items, total, discount, paid, written_off, status, coupon_code, customer_name, created_at",
      )
      .eq("restaurant_id", r.id)
      .eq("paid", false)
      .is("account_id", null)
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
  // Every read here throws when it fails, rather than being taken as empty.
  // This is the screen money is collected from: an unread list of bills read
  // as "no open tables", and an unread ledger as "nothing collected yet", so
  // the whole amount looked owing and could be taken again. The error screen
  // says no order was lost and offers a retry, which is the true answer.
  const orders = unwrap(ordersRes, "the open bills");
  const requests = unwrap(requestsRes, "the discount requests");
  const writeOffs = unwrap(writeOffsRes, "the write-off requests");
  const asking = unwrap(askingRes, "who asked for the bill");
  const requestCurrencies = await billRequestCurrencies(r.id,[...(requests ?? []),...(writeOffs ?? [])]);

  // Their own takings, read here with the secret key rather than by widening
  // any policy. `payments` is nobody's to read from a browser, and it stays
  // that way: the filter below is the session's own email, so nobody sees
  // anybody else's collections and no new door was opened to get there.
  const me = await currentUser();
  const dayStart = startOfLocalDay(new Date(), r.timezone ?? DEFAULT_TIME_ZONE);
  const myPayments = me?.email
    // Every row: a busy counter takes more payments in a day than one read
    // returns, and a till summed from part of them is short money nobody lost.
    ? await everyRow<{ amount: number; method: "cash" | "card" }>((a, b) => db
        .from("payments")
        .select("amount, method")
        .eq("restaurant_id", r.id).eq("currency", r.currency)
        .eq("actor_email", me.email)
        .gte("created_at", dayStart.toISOString())
        .order("id").range(a, b), "your takings today")
    : null;
  const till = myPayments ? tillFrom(myPayments) : EMPTY_TILL;

  // Card payments that landed on a bill already collected: the diner's money,
  // waiting to be given back. Owner and manager only, the same line as the
  // route that refunds them. The Stripe account is read with the secret key
  // because a browser's own client is not granted that column.
  const refunds = MANAGES(membership.role) ? await refundsDue(r.id) : [];
  const stripeAccount = refunds.length
    ? (unwrap(
        await db.from("restaurants").select("stripe_account_id").eq("id", r.id).single(),
        "the restaurant's Stripe account",
      ) as { stripe_account_id: string | null } | null)
    : null;

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
  const liveSplits = unwrap(
    await db
      .from("bill_splits")
      .select("id, session_id, shares, model_version, currency, order_ids, bill_split_claims(paid_at, amount), bill_split_slots(payment_id)")
      .eq("restaurant_id", r.id)
      .in("status", ["proposed", "locked"]),
    "the bills being divided",
  );

  type LiveSplit = {
    session_id: string;
    shares: number;
    model_version: number; currency: string | null; order_ids: string[];
    bill_split_slots: { payment_id: string | null }[] | null;
    bill_split_claims: { paid_at: string | null; amount: number }[] | null;
  };
  const splits = ((liveSplits ?? []) as unknown as LiveSplit[]).map(s => ({
    session_id: s.session_id,
    shares: s.shares,
    currency: s.currency ?? rows.find(o => s.order_ids?.includes(o.id))?.currency,
    paidShares: s.model_version === 2 ? (s.bill_split_slots ?? []).filter(slot => slot.payment_id).length
      : (s.bill_split_claims ?? []).filter(c => c.paid_at).length,
  }));

  // What each of those sittings has already handed over, from the ledger: a
  // share of a divided bill and a waiter's collection at the table are the
  // same money as far as this board is concerned, and both leave every order
  // reading as unpaid until the bill closes. `order_id is null` is what makes
  // it the sitting's rather than one order's — an order-level payment left
  // with the order it settled.
  const coverage = await paymentCoverage(r.id, rows, true);

  const unresolved = MANAGES(membership.role) ? await everyRow<{
    id: string; amount: number; tip: number; currency: string; created_at: string;
  }>((a, b) => db.from("payments").select("id, amount, tip, currency, created_at")
    .eq("restaurant_id", r.id).eq("allocation_quality", "unresolved").order("id").range(a, b), "the historical receipts") : [];

  // `canCollectInParts` and `canDiscount` are what the ROUTES will actually
  // accept. Both refuse on a plan without the feature, and this screen offered
  // them anyway: on `servicio` — a paying tier — the calculator opened a
  // discount picker, filled it from an endpoint that is NOT plan-gated, and
  // the apply came back 409. The waiter chose a code in front of the customer.
  return (
    <ConfirmProvider>
      <BillsPanel
        bills={withSplits(openBills(rows as Order[], coverage), splits, sessionOf).map(b => ({
          ...b, collected: b.orderIds.reduce((sum,id) => sum + (coverage.get(id) ?? 0),0),
        }))}
        requests={MANAGES(membership.role) ? (requests ?? []).map(a => ({ ...a,currency: requestCurrencies.get(a.id) ?? null })) : []}
        writeOffs={MANAGES(membership.role) ? (writeOffs ?? []).map(a => ({ ...a,currency: requestCurrencies.get(a.id) ?? null })) : []}
        currency={r.currency}
        canApprove={MANAGES(membership.role)}
        restaurantId={r.id}
        canSettle={SETTLES(membership.role)}
        canCollectInParts={Boolean(plan && can(plan.limits, "waiterService"))}
        canDiscount={Boolean(plan && can(plan.limits, "staffDiscounts"))}
        canChargeAccount={Boolean(plan && can(plan.limits, "openAccounts"))}
        askedToPay={(asking ?? []).map(a => a.table_id).filter(Boolean) as string[]}
        loyalty={await loyaltyOn(r.id, plan?.limits ?? null)}
      >
        {/* Owner only, because that is all the database will hand over: the
            policy on `user_logs` is `owns_restaurant`. Showing it to a manager
            meant the gate said yes and the database returned zero — the manager
            opened "Actividad reciente" with its search box, its sort buttons
            and an empty list, and left thinking the log was broken.

            The policy is not widened to match: the log also carries staff
            hires, removals and role changes, and a manager does not reach
            /dashboard/staff. */}
        {/* Above the till: money that is somebody else's comes before counting ours. */}
        <PaymentAttribution receipts={unresolved} timeZone={r.timezone ?? DEFAULT_TIME_ZONE} />
        <OrderRefunds refunds={MANAGES(membership.role) ? await orderRefunds(r.id) : []} />
        <RefundsDue
          refunds={refunds}
          canRefund={Boolean(stripeAccount?.stripe_account_id)}
        />
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
