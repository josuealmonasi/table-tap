"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { canPayMineOnly, ordersToPay, tableBill, type TableBill } from "@/lib/table-bill";
import { dinerCurrency } from "@/lib/diner-currency";
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
   * to the person standing in front of them. Whole-bill card checkout stays
   * hidden; model-2 payments use the same parts as the waiter, so both see what
   * has already been paid and neither can collect a part twice.
   */
  staffBill?: boolean;
  /**
   * How many devices have ordered on this table.
   *
   * Only the legacy model-1 flow uses this ceiling. New splits count people,
   * and one phone may pay several parts.
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
  bill: allBill,
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
  const [chosenCurrency, setChosenCurrency] = useState<string | null>(null);
  const allOrders = [...allBill.mine.orders, ...allBill.others.orders, ...allBill.paid.orders];
  const currencies = [...new Set([...allBill.mine.orders, ...allBill.others.orders].map(o => o.currency))];
  const paidCurrencies = [...new Set(allBill.paid.orders.map(o => o.currency))];
  const currency = chosenCurrency && currencies.includes(chosenCurrency) ? chosenCurrency : currencies[0] ?? restaurant.currency;
  const bill = tableBill(allOrders.filter(o => o.currency === currency), allBill.mine.orders.map(o => o.id));
  const mixed = currencies.length > 1;
  const [scope, setScope] = useState<"all" | "mine">("all");
  const { busy, called, payShare, paySlots, payOnline, payAtTable } = useBillPayment(
    restaurant.id,
    tableId,
    sessionId,
    bill.mine.orders.map(order => order.id),
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
  // seconds. Existing parts stay visible even if the owner turns splitting
  // off; hiding them would offer the whole bill over money already paid.
  const {
    split,
    ready: splitReady,
    diner,
    busy: splitBusy,
    error: splitError,
    propose,
    join,
    resize,
    refresh: refreshSplit,
    cancel: cancelSplit,
  } = useSplit(
    restaurant.id,
    tableId,
    sessionId,
    open && Boolean(sessionId),
    bill.mine.orders.filter(o => !o.paid).map(o => o.id),
    { expectedCents: Math.round(bill.total * 100), currency },
  );

  // Once it has frozen, the split card is how this table pays. Everything that
  // settles the WHOLE bill is put away — whether or not this phone took a
  // share. A phone that ordered and never joined still had the button: three
  // ordered, two of them halved it, and the third could pay for the lot while
  // the two halves were being collected. One dinner, charged twice.
  const splitLocked = dividing || split?.status === "locked" || split?.modelVersion === 2;
  const checkingSplit = Boolean(sessionId) && !splitReady;
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
  const alone = Boolean(noCard) || splitLocked || checkingSplit;

  const [tipPct, setTipPct] = useState(0);
  const [tipCustom, setTipCustom] = useState<number | null>(null);
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);

  const orders = ordersToPay(bill, scope);
  // A coupon is offered only when none of the orders being settled already
  // carries one — that discount is inside their totals, and a second would take
  // the same money off twice.
  const alreadyDiscounted = orders.some(o => o.coupon_code || Number(o.collected) > 0);

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
      {splitError && <p className="tt-field-error" role="alert">{splitError}</p>}
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 12 }}>
        {t("bill.title", { label: tableLabel })}
      </h3>

      {mixed && <div role="group" aria-label={t("settle.currency")}>
        <p className="tt-muted">{t("settle.mixed")}</p>
        {currencies.map(c => <button key={c} type="button" className="tt-tip-chip" onClick={() => { setChosenCurrency(c); setScope("all"); setCoupon(null); setTipCustom(null); setTipPct(0); }}>
          {formatMoney(tableBill(allOrders.filter(o => o.currency === c), []).total, c)}
        </button>)}
      </div>}

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
          {paidCurrencies.map(c => {
            const paid = tableBill(allBill.paid.orders.filter(o => o.currency === c), []).paid;
            return <BillSection key={c} heading={t("bill.alreadyPaid", { amount: formatMoney(paid.total,c) })}
              side={paid} currency={c} photoOf={photoOf} settled collapsible />;
          })}

          {coupon && <p className="tt-muted">{t(split ? "slots.couponNotIncluded" : "slots.couponFirst")}</p>}

          {/* Dividing it evenly is a decision about the whole bill, so it is
              asked before the smaller question of whose dishes to pay for.
              Every part exists at once, even without a card account. The
              waiter and the phones choose from the same list, so cash and
              cards cannot both pay the same food. */}
          {(split?.modelVersion === 2 || (split && !staffBill) || (!split && !coupon && can.split && sessionId && splitReady && !mixed)) && (
            <SplitBillCard
              split={split}
              diner={diner}
              tipPct={tipPct}
              busy={splitBusy || busy}
              currency={dinerCurrency(ordersToPay(bill, "all")) ?? currency}
              outstanding={tableBill(allOrders.filter(o => o.currency === (split?.currency ?? currency)), []).total}
              party={party}
              cardsEnabled={Boolean(restaurant.cards_enabled)}
              propose={propose}
              join={join}
              resize={resize}
              cancel={cancelSplit}
              onPay={(slots, tipCents) =>
                split?.modelVersion === 2 && slots && split.revision
                  ? paySlots({ splitId: split.id, revision: split.revision, slots, tipCents,
                    expectedCents: (split.slots ?? []).filter(s => slots.includes(s.shareNo)).reduce((sum, s) => sum + s.amountCents, 0) }).then(() => refreshSplit())
                  : split?.mine
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
          {!splitLocked && !checkingSplit && can.extras && (
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
          {!splitLocked && !checkingSplit && (
            <BillTotals amounts={amounts} restaurant={{ ...restaurant, currency }} tipPct={tipPct} tipCustom={tipCustom} />
          )}

          <BillActions
            called={called}
            busy={busy}
            alone={alone}
            reasonKey={checkingSplit ? "slots.checking" : splitLocked ? "bill.dividing" : noCard}
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
