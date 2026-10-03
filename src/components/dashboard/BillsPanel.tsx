"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Breadcrumb from "@/components/layout/Breadcrumb";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import { matchesBill, type OpenBill } from "@/lib/open-bills";
import BillDiscountDialog from "./BillDiscountDialog";
import SettleTableDialog from "./SettleTableDialog";
import { SearchIcon } from "@/components/ui/icons";
import ScanToCollect from "./ScanToCollect";
import OpenBillRow from "./OpenBillRow";
import BillApprovals, {
  type DiscountRequest,
  type WriteOffRequest,
} from "./BillApprovals";
import StampCard from "./loyalty/StampCard";
import { useLiveOrders } from "@/hooks/useLiveOrders";

/**
 * Open bills, searchable, with the promotion a manager may apply to one.
 *
 * Built like the rest of the dashboard's lists: a section per group of rows,
 * each row a line of the same height with its identity on the left and its
 * money on the right. A manager reads down the right edge to find the table
 * they were told about, so the amounts have to line up.
 */
export default function BillsPanel({
  bills,
  requests,
  writeOffs,
  currency,
  canApprove,
  restaurantId,
  canSettle,
  canCollectInParts,
  canDiscount,
  canChargeAccount,
  askedToPay,
  loyalty = false,
  children,
}: {
  bills: OpenBill[];
  requests: DiscountRequest[];
  writeOffs: WriteOffRequest[];
  currency: string;
  canApprove: boolean;
  restaurantId: string;
  /** Front of house can take the money; the kitchen cannot. */
  canSettle: boolean;
  /** The plan carries waiter service — without it /api/table-payment/part
   *  answers 403 and the calculator is a door into a refusal. */
  canCollectInParts: boolean;
  /** The plan carries staff discounts — without it /api/bill/discount
   *  answers 403, however willingly the picker fills itself. */
  canDiscount: boolean;
  /** The plan carries customer accounts: a bill can go on one. */
  canChargeAccount: boolean;
  /** Tables that asked for the bill and are waiting for somebody to come. */
  askedToPay: string[];
  /** The restaurant takes visit-card stamps right now: plan and program both. */
  loyalty?: boolean;
  /** The activity log, for whoever may see it. */
  children?: React.ReactNode;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  // Another waiter collects on a table and this list finds out by itself.
  useLiveOrders(restaurantId);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<OpenBill | null>(null);
  // The table being collected on, if any.
  const [settling, setSettling] = useState<OpenBill | null>(null);

  // Arriving from a scanned code: /dashboard/bills?order=<id> opens that bill
  // ready to collect. The diner holds the code up, whoever is charging them
  // points a camera at it, and the till is already on the right order — no
  // reading a code aloud across a counter and no hunting the list.
  //
  // The id in the URL grants nothing on its own: this page is staff-gated and
  // the bill has to be one of THIS restaurant's, which is why the match is
  // against the list the server already scoped rather than a fresh lookup.
  const scanned = useSearchParams().get("order");

  /**
   * Open the bill a scanned code points at.
   *
   * Matched against the list the server already scoped to this restaurant, so
   * another venue's code finds nothing here — and says so, rather than opening
   * silently onto the wrong thing or appearing to do nothing at all.
   */
  const openScanned = useCallback(
    (orderId: string) => {
      const found = bills.find(b => b.orderIds.includes(orderId));
      if (found) setSettling(found);
      else toast(t("scan.notHere"), "error");
    },
    [bills, toast, t],
  );

  useEffect(() => {
    if (scanned) openScanned(scanned);
  }, [scanned, openScanned]);

  // "waiting 1h 40m" is a different sentence a minute later, so the server's
  // answer and the browser's disagree and React reports a hydration mismatch.
  // The wait is measured after mount instead — and again every half minute, so
  // a manager watching the list sees it climb rather than freeze.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  const shown = useMemo(() => bills.filter(b => matchesBill(b, query)), [bills, query]);
  const owed = shown.reduce((sum, b) => sum + b.total, 0);

  // Having a balance and asking for the bill are not the same: the first is
  // nearly the whole room, the second is somebody with a hand up. The ones
  // asking go on top and apart, because they are the ones to serve now.
  const waiting = useMemo(() => new Set(askedToPay), [askedToPay]);
  const toCollect = useMemo(
    () => shown.filter(b => b.tableId && waiting.has(b.tableId)),
    [shown, waiting],
  );
  const rest = useMemo(
    () => shown.filter(b => !(b.tableId && waiting.has(b.tableId))),
    [shown, waiting],
  );

  const row = (bill: OpenBill) => (
    <OpenBillRow
      key={bill.key}
      bill={bill}
      currency={currency}
      now={now}
      canSettle={canSettle}
      onOpen={setChosen}
      onCollect={setSettling}
    />
  );

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[
              { labelKey: "nav.dashboard", href: "/dashboard" },
              { labelKey: "nav.bills" },
            ]}
          />
        </header>

        {/* Somebody is standing at a table waiting on these, so they lead. */}
        <BillApprovals requests={requests} writeOffs={writeOffs} currency={currency} />

        <div className="tt-section">
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>
              {t("dash.bills")}
            </h3>
            <span className="tt-muted" style={{ fontSize: 12 }}>
              {formatMoney(owed, currency)}
            </span>
          </div>
          <p className="tt-muted" style={{ fontSize: 13, marginTop: 0 }}>
            {t("dash.billsDesc")}
          </p>

          {/* Scanning sits beside the search, not instead of it: a diner who
              says their name or reads out their code is served exactly as
              before, and this is for the queue. */}
          <div className="tt-bill-find">
            <div className="tt-bill-search">
              <SearchIcon size={16} weight="bold" />
              <input
                className="tt-input"
                value={query}
                placeholder={t("dash.billsSearch")}
                aria-label={t("dash.billsSearch")}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
            <ScanToCollect onFound={openScanned} />
            {loyalty && canSettle && <StampCard />}
          </div>

          {shown.length === 0 ? (
            <p className="tt-muted" style={{ marginTop: 16, marginBottom: 4 }}>
              {t("dash.billsEmpty")}
            </p>
          ) : (
            <div className="tt-bill-list">
              {toCollect.length > 0 && (
                <p className="tt-bill-group">{t("dash.toCollect")}</p>
              )}
              {toCollect.map(row)}
              {toCollect.length > 0 && rest.length > 0 && (
                <p className="tt-bill-group">{t("dash.stillOpen")}</p>
              )}
              {rest.map(row)}
            </div>
          )}
        </div>

        {/* Inside the container: outside it the log hugged the window edge
            while the card above respected the page margin, and the two sections
            lined up on neither side. */}
        {children}
      </div>

      {settling && (
        <SettleTableDialog
          open
          restaurantId={restaurantId}
          tableId={settling.tableId}
          // With no table, the bill is the order itself; `openBills` groups each
          // counter order into its own row, so there is exactly one.
          orderId={settling.tableId ? null : settling.orderIds[0]}
          tableLabel={
            settling.tableLabel ??
            [settling.code, settling.customerName].filter(Boolean).join(" · ")
          }
          currency={currency}
          canApprove={canApprove}
          canCollectInParts={canCollectInParts}
          canDiscount={canDiscount}
          canChargeAccount={canChargeAccount}
          onClose={() => setSettling(null)}
          onSettled={() => router.refresh()}
          // The same promotion dialog the row opens, reached without leaving
          // the table: one dialog at a time, so collecting steps aside for it.
          onDiscount={() => {
            setChosen(settling);
            setSettling(null);
          }}
        />
      )}
      {chosen && (
        <BillDiscountDialog
          open
          bill={chosen}
          currency={currency}
          canApprove={canApprove}
          onClose={() => setChosen(null)}
          onApplied={() => router.refresh()}
        />
      )}
    </div>
  );
}
