"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { canPayMineOnly, ordersToPay, type TableBill } from "@/lib/table-bill";
import type { AppliedCoupon } from "@/lib/pricing";
import BillTotals from "./BillTotals";
import BillExtras from "./BillExtras";
import BillScopeChips from "./BillScopeChips";
import BillSection from "./BillSection";
import BillActions from "./BillActions";
import type { Restaurant } from "@/lib/types";
import { billAmounts } from "@/lib/bill-amounts";
import { billActions, billHintKey } from "@/lib/payment-options";
import SplitBillCard from "@/components/customer/SplitBillCard";
import { useSplit } from "@/hooks/useSplit";
import { useBillPayment } from "@/hooks/useBillPayment";

interface BillSheetProps {
  open: boolean;
  onClose: () => void;
  bill: TableBill;
  restaurant: Restaurant;
  tableId: string;
  tableLabel: string;
  /** The dish's photo, looked up from the live menu — null falls back to emoji. */
  photoOf: (itemId: string) => string | null;
  /** The sitting this phone is bound to; without one there is no table to
   *  divide a bill with. */
  sessionId?: string | null;
  /**
   * A waiter opened this bill and is settling it in person.
   *
   * The diners can watch what has been ordered and add to it; the money goes
   * to the person standing in front of them. So no card field and no dividing
   * it here — the waiter has a calculator that does the same job, and the
   * routes refuse a charge anyway. Offering a button the system turns down is
   * worse than not offering it.
   */
  staffBill?: boolean;
  /**
   * How many devices have ordered on this table.
   *
   * The ceiling on dividing the bill. Nothing else on this screen uses it —
   * what somebody pays is always summed from the orders.
   */
  party?: number;
  /**
   * The table has frozen a split, as the server sees it.
   *
   * Read from /api/bill rather than from the split hook, because that one
   * answers about a SITTING and a phone only knows its sitting if it ordered
   * from this device. One that scanned and did not order saw no split at all,
   * and was offered the whole bill — which the route refused.
   */
  dividing?: boolean;
}

/**
 * The bill, laid out as the checkout the diner already knows.
 *
 * Paying for food already eaten is the same act as paying for food about to be
 * cooked, so it is the same screen: the dishes, a tip, the totals card, then
 * the button. The only differences are that the lines cannot be edited — the
 * kitchen has already made them — and that the table's own share is separated
 * from everybody else's.
 *
 * A coupon applies to the share being paid, not to the table — so two people
 * splitting a bill can each use their own code on their own food. Orders that
 * were already discounted when they were placed can't take a second one; the
 * server refuses that, and the box is hidden here so nobody tries.
 */
export default function BillSheet({
  open,
  onClose,
  bill,
  restaurant,
  sessionId = null,
  tableId,
  tableLabel,
  photoOf,
  staffBill = false,
  party = 0,
  dividing = false,
}: BillSheetProps) {
  const t = useT();
  const currency = restaurant.currency;
  const [scope, setScope] = useState<"all" | "mine">("all");
  const { busy, called, payShare, payOnline, payAtTable } = useBillPayment(
    restaurant.id,
    tableId,
    sessionId,
  );

  // What this bill can actually be settled with. Every route that charges a
  // card refuses without a connected Stripe account, so a screen that offers
  // one is a screen promising a refusal — which is what Mesa 10 got, dressed
  // up as a network error.
  const pay = {
    cardsEnabled: Boolean(restaurant.cards_enabled),
    staffBill,
    splitAllowed: restaurant.split_enabled !== false,
  };
  const can = billActions(pay);
  const noCard = billHintKey(pay);

  // Only while the sheet is open, and only while dividing it leads anywhere:
  // a bill nobody is looking at does not need asking about every five
  // seconds, and one that cannot be paid by card cannot be paid by share.
  const {
    split,
    diner,
    busy: splitBusy,
    propose,
    join,
    cancel: cancelSplit,
  } = useSplit(
    restaurant.id,
    tableId,
    sessionId,
    open && can.split,
    bill.mine.orders.filter(o => !o.paid).map(o => o.id),
  );

  // Once it has frozen, the split card is how this table pays. Everything that
  // settles the WHOLE bill is put away — whether or not this phone took a
  // share. A phone that ordered and never joined still had the button: three
  // ordered, two of them halved it, and the third could pay for the lot while
  // the two halves were being collected. One dinner, charged twice.
  const splitLocked = can.split && (dividing || split?.status === "locked");
  /**
   * Is calling somebody over the only thing left on this screen?
   *
   * Either because the restaurant takes no cards, or because a waiter opened
   * the bill, or because the table has frozen a split and pays through the
   * shares. In all three the waiter button stands alone, so it is the primary
   * one — and it is ALWAYS here. Gated behind the split it left a phone with
   * no share looking at a bill and no way to do anything about it, not even
   * ask for help, which is worse than the button it was hiding.
   */
  const alone = Boolean(noCard) || splitLocked;

  const [tipPct, setTipPct] = useState(0);
  const [tipCustom, setTipCustom] = useState<number | null>(null);
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);

  const orders = ordersToPay(bill, scope);
  // A coupon is offered only when none of the orders being settled already
  // carries one — that discount is inside their totals, and a second would take
  // the same money off twice.
  const alreadyDiscounted = orders.some(o => o.coupon_code);

  // What the chosen scope comes to, line by line.
  const amounts = billAmounts(bill, scope, coupon, tipPct, tipCustom);
  const myUnpaid = bill.mine.orders.filter(o => !o.paid).map(o => o.id);

  // Switching what you're paying for changes the amount the coupon was checked
  // against, so the code is re-entered rather than silently re-priced.
  function changeScope(next: "all" | "mine"): void {
    setScope(next);
    setCoupon(null);
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth={460} label={t("bill.open")}>
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 12 }}>
        {t("bill.title", { label: tableLabel })}
      </h3>

      {bill.settled ? (
        <p className="tt-muted">{t("bill.empty")}</p>
      ) : (
        <>
          <BillSection
            heading={t("bill.yours")}
            side={bill.mine}
            currency={currency}
            photoOf={photoOf}
          />
          <BillSection
            heading={t("bill.othersAtTable")}
            side={bill.others}
            currency={currency}
            photoOf={photoOf}
          />
          {/* What is already paid stays visible and out of the total: whoever
              paid for their dish by card needs to see it, and the rest of the
              table needs to understand why they are not being charged for it. */}
          <BillSection
            heading={t("bill.alreadyPaid", {
              amount: formatMoney(bill.paid.total, currency),
            })}
            side={bill.paid}
            currency={currency}
            photoOf={photoOf}
            settled
            collapsible
          />

          {/* Dividing it evenly is a decision about the whole bill, so it is
              asked before the smaller question of whose dishes to pay for.
              Not on a bill the waiter is settling: they are standing there
              with a calculator that divides it, and two of us collecting the
              same bill is how a table pays twice. And not without a card
              reader behind it: a share is charged through the same route as
              the whole bill, so dividing one twelve ways with no Stripe
              account produces twelve people who cannot pay. */}
          {can.split && (
            <SplitBillCard
              split={split}
              diner={diner}
              busy={splitBusy || busy}
              currency={currency}
              outstanding={bill.total}
              party={party}
              cardsEnabled={Boolean(restaurant.cards_enabled)}
              propose={propose}
              join={join}
              cancel={cancelSplit}
              onPay={() =>
                split?.mine
                  ? payShare({ splitId: split.id, diner, ownOrderIds: myUnpaid, tipPct })
                  : Promise.resolve()
              }
            />
          )}

          {/* Paying for the table or only for yourself changes what the totals
              below are counting, so it sits above them. */}
          {!split && canPayMineOnly(bill) && (
            <BillScopeChips scope={scope} onChange={changeScope} />
          )}

          {/* Everything below settles the WHOLE bill, which is not what this
              phone owes any more once the table has divided it. Two ways to
              pay, disagreeing about the amount, is how somebody pays twice. */}
          {!splitLocked && can.extras && (
            <BillExtras
              restaurantId={restaurant.id}
              currency={currency}
              couponOffered={!alreadyDiscounted && Boolean(restaurant.coupons_enabled)}
              food={amounts.food}
              coupon={coupon}
              onCoupon={setCoupon}
              tipPct={tipPct}
              tipCustom={tipCustom}
              maxTip={amounts.base}
              onTipPct={pct => {
                setTipPct(pct);
                setTipCustom(null);
              }}
              onTipCustom={setTipCustom}
            />
          )}

          {/* Calling somebody over always works, so the button at the bottom is
              always offered. What is gated is the rest: a frozen split settles
              through the shares, and a total with a card button under it is a
              second way to pay the same food. */}
          {!splitLocked && (
            <BillTotals amounts={amounts} restaurant={restaurant} tipPct={tipPct} tipCustom={tipCustom} />
          )}

          <BillActions
            called={called}
            busy={busy}
            alone={alone}
            reasonKey={splitLocked ? "bill.dividing" : noCard}
            onPayOnline={() =>
              payOnline({
                orderIds: orders.map(o => o.id),
                couponCode: coupon?.code,
                tipPct,
                tipCustom,
              })
            }
            onPayAtTable={payAtTable}
          />
        </>
      )}
    </Modal>
  );
}
