"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import {
  canPayMineOnly,
  ordersToPay,
  PAID_LINES_SHOWN,
  type BillSide,
  type TableBill,
} from "@/lib/table-bill";
import { applyCoupon, itemSalePrice } from "@/lib/pricing";
import { rememberSettling } from "@/hooks/useReceiptOffer";
import type { AppliedCoupon } from "@/lib/pricing";
import CouponBox from "./CouponBox";
import DishImage from "./DishImage";
import OrderTotals from "./OrderTotals";
import TipPicker from "./TipPicker";
import type { Restaurant } from "@/lib/types";
import { round2 } from "@/lib/money";
import { billActions, billHintKey } from "@/lib/payment-options";
import SplitBillCard from "@/components/customer/SplitBillCard";
import { useSplit } from "@/hooks/useSplit";

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

/** One dish on the bill, laid out like a cart line but not editable. */
function BillLine({
  name,
  emoji,
  imageUrl,
  qty,
  price,
  discountPct,
  extras,
  currency,
}: {
  name: string;
  emoji: string;
  imageUrl: string | null;
  qty: number;
  price: number;
  /** What came off this dish when it was ordered; the total already has it. */
  discountPct?: number;
  extras?: { name: string; price: number }[];
  currency: string;
}) {
  // What this line actually contributed to the bill: the sale price the dish
  // was ordered at, plus its extras. Showing the list price here made the
  // lines add up to more than the total a diner was being asked to pay —
  // 13.50 of dishes under a total of 11.70 — which is the sort of arithmetic
  // that gets a bill queried in front of everyone.
  const extrasEach = (extras ?? []).reduce((sum, e) => sum + e.price, 0);
  const charged = (itemSalePrice(price, discountPct) + extrasEach) * qty;
  const listed = (price + extrasEach) * qty;
  return (
    <div className="tt-card" style={{ padding: 14 }}>
      <div className="tt-line">
        <div className="tt-line-thumb">
          <DishImage url={imageUrl} emoji={emoji} name={name} />
        </div>
        <div className="tt-line-body">
          <strong>
            {qty}× {name}
          </strong>
        </div>
        <div className="tt-line-actions">
          {charged < listed && (
            <span className="tt-was" style={{ fontSize: 13 }}>
              {formatMoney(listed, currency)}
            </span>
          )}
          <strong className="tt-accent">{formatMoney(charged, currency)}</strong>
        </div>
      </div>
    </div>
  );
}

function Section({
  heading,
  side,
  currency,
  photoOf,
  settled = false,
  collapsible = false,
}: {
  heading: string;
  side: BillSide;
  currency: string;
  photoOf: (itemId: string) => string | null;
  /** Already paid: shown dimmed and counted in no total. */
  settled?: boolean;
  /** Summarised when there are many rows, so the total is not pushed off screen. */
  collapsible?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (side.orders.length === 0) return null;
  const foldable = collapsible && side.items.length > PAID_LINES_SHOWN;
  const shown = foldable && !open ? side.items.slice(0, PAID_LINES_SHOWN) : side.items;
  return (
    <div className={settled ? "tt-bill-settled" : undefined}>
      <div className="tt-mod-label" style={{ marginTop: 4 }}>
        {heading}
        {settled && <span className="tt-badge tt-badge-green">{"\u2713"}</span>}
        {foldable && (
          <button
            type="button"
            className="tt-linkbtn"
            aria-expanded={open}
            onClick={() => setOpen(v => !v)}
          >
            {t(open ? "bill.hideLines" : "bill.showLines", { n: side.items.length })}
          </button>
        )}
      </div>
      {shown.map((item, i) => (
        <BillLine
          key={i}
          name={item.name}
          emoji={item.emoji}
          imageUrl={photoOf(item.itemId)}
          qty={item.qty}
          price={item.price}
          discountPct={item.discountPct}
          extras={item.extras}
          currency={currency}
        />
      ))}
    </div>
  );
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
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [called, setCalled] = useState(false);
  const [scope, setScope] = useState<"all" | "mine">("all");

  // What this bill can actually be settled with. Every route that charges a
  // card refuses without a connected Stripe account, so a screen that offers
  // one is a screen promising a refusal — which is what Mesa 10 got, dressed
  // up as a network error.
  const pay = { cardsEnabled: Boolean(restaurant.cards_enabled), staffBill };
  const can = billActions(pay);
  const noCard = billHintKey(pay);

  // Only while the sheet is open, and only while dividing it leads anywhere:
  // a bill nobody is looking at does not need asking about every five
  // seconds, and one that cannot be paid by card cannot be paid by share.
  const {
    split, diner, busy: splitBusy, propose, join, cancel: cancelSplit,
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

  /** Their share, plus anything they ordered since it froze. */
  async function payShare(): Promise<void> {
    if (!split?.mine || !sessionId || busy) return;
    setBusy(true);
    try {
    const res = await fetch("/api/split/pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        splitId: split.id,
        sessionId,
        diner,
        restaurantId: restaurant.id,
        tableId,
        // Which orders this phone believes are its own. Checked on the server
        // against what was actually placed after the freeze.
        ownOrderIds: bill.mine.orders.filter(o => !o.paid).map(o => o.id),
        tipPct,
      }),
    });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      // Only a redirect leaves this screen. Anything else has to say so: a pay
      // button that silently does nothing is a button somebody taps again, and
      // this one opens a Stripe session each time.
      //
      // And it says what the SERVER said. Every refusal here already carries a
      // sentence in the diner's language — the share is not frozen yet, the
      // waiter is collecting, the restaurant takes no cards — and reporting
      // all of them as "network error, try again" sent a table of twelve to
      // press the same button again.
      if (data.url) window.location.href = data.url;
      else {
        toast(data.error ?? t("done.networkError"), "error");
        setBusy(false);
      }
    } catch {
      toast(t("done.networkError"), "error");
      setBusy(false);
    }
  }
  const [tipPct, setTipPct] = useState(0);
  const [tipCustom, setTipCustom] = useState<number | null>(null);
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);

  const orders = ordersToPay(bill, scope);
  // A coupon is offered only when none of the orders being settled already
  // carries one — that discount is inside their totals, and a second would take
  // the same money off twice.
  const alreadyDiscounted = orders.some(o => o.coupon_code);

  // What the chosen scope comes to, before any tip.
  const food = scope === "mine" ? bill.mine.total : bill.total;
  // Promotions already taken off — a code the floor applied to this table, or
  // one used when ordering. `food` is net of it, so the lines above add up to
  // more than the total unless it is shown, and a bill that doesn't add up is
  // a bill nobody trusts.
  const applied = scope === "mine" ? bill.mine.discount : bill.discount;
  const discount = round2(applied + (coupon ? applyCoupon(coupon, food) : 0));
  const base = round2(food - (coupon ? applyCoupon(coupon, food) : 0));
  const tip = tipCustom !== null ? Math.min(tipCustom, base) : round2(base * (tipPct / 100));
  const total = round2(base + tip);

  async function payOnline(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/bill/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId: restaurant.id,
          tableId,
          // Which orders, and how much to add on top. The food's price is
          // summed from the stored rows either way.
          orderIds: orders.map(o => o.id),
          couponCode: coupon?.code,
          tipPct: tipCustom === null ? tipPct : undefined,
          tipAmount: tipCustom ?? undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (data.url) {
        // Stripe sends them back to the menu, where the bill is already gone —
        // so what they just paid for is noted here, while it is still known,
        // for the receipt offer waiting on the other side.
        rememberSettling(orders.map(o => o.id));
        window.location.href = data.url;
      }
      else {
        toast(data.error ?? t("done.networkError"), "error");
        setBusy(false);
      }
    } catch {
      toast(t("done.networkError"), "error");
      setBusy(false);
    }
  }

  // Switching what you're paying for changes the amount the coupon was checked
  // against, so the code is re-entered rather than silently re-priced.
  function changeScope(next: "all" | "mine"): void {
    setScope(next);
    setCoupon(null);
  }

  /**
   * Ask for somebody to come and take the money.
   *
   * The answer is read. It used to be thrown away, and "a waiter is on the
   * way" was shown whatever came back — a rate limit, a table that no longer
   * exists, a server that was down. Telling a table somebody is coming when
   * nobody has been told is the worst version of this screen's one job.
   */
  async function payAtTable(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId: restaurant.id, tableId, kind: "pay" }),
      });
      if (res.ok) {
        setCalled(true);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast(data.error ?? t("done.networkError"), "error");
    } catch {
      toast(t("done.networkError"), "error");
    } finally {
      setBusy(false);
    }
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
          <Section heading={t("bill.yours")} side={bill.mine} currency={currency} photoOf={photoOf} />
          <Section
            heading={t("bill.othersAtTable")}
            side={bill.others}
            currency={currency}
            photoOf={photoOf}
          />
          {/* What is already paid stays visible and out of the total: whoever
              paid for their dish by card needs to see it, and the rest of the
              table needs to understand why they are not being charged for it. */}
          <Section
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
          {can.split && <SplitBillCard
            split={split}
            diner={diner}
            busy={splitBusy || busy}
            currency={currency}
            outstanding={bill.total}
            party={party}
            propose={propose}
            join={join}
            cancel={cancelSplit}
            onPay={payShare}
          />}

          {/* Paying for the table or only for yourself changes what the totals
              below are counting, so it sits above them. */}
          {!split && canPayMineOnly(bill) && (
            <div className="tt-tip-row tt-bill-scope">
              <button
                type="button"
                className={`tt-tip-chip ${scope === "all" ? "tt-tip-chip-active" : ""}`}
                onClick={() => changeScope("all")}
              >
                {t("bill.scopeAll")}
              </button>
              <button
                type="button"
                className={`tt-tip-chip ${scope === "mine" ? "tt-tip-chip-active" : ""}`}
                onClick={() => changeScope("mine")}
              >
                {t("bill.scopeMine")}
              </button>
            </div>
          )}

          {/* Everything below settles the WHOLE bill, which is not what this
              phone owes any more once the table has divided it. Two ways to
              pay, disagreeing about the amount, is how somebody pays twice. */}
          {!splitLocked && !alreadyDiscounted && can.extras && (
            <div className="tt-coupon-row">
              <CouponBox
                restaurantId={restaurant.id}
                subtotal={food}
                applied={coupon}
                onApply={setCoupon}
                onRemove={() => setCoupon(null)}
              />
            </div>
          )}

          {/* Neither the code nor the tip does anything on a bill somebody
              is collecting in person: both are theirs to take at the table, on
              the same screen they take the money on. A field that changes no
              number is a promise the system will not keep — and with no card
              behind the bill at all, neither of them changes anything. */}
          {!splitLocked && can.extras && (
          <div style={{ marginTop: 16 }}>
            <TipPicker
              currency={currency}
              tipPct={tipPct}
              tipCustom={tipCustom}
              maxTip={base}
              onPresetTip={pct => {
                setTipPct(pct);
                setTipCustom(null);
              }}
              onCustomTip={setTipCustom}
            />
          </div>
          )}

          {/* Calling somebody over always works, so the button at the bottom is
              always offered. What is gated is the rest: a frozen split settles
              through the shares, and a total with a card button under it is a
              second way to pay the same food. */}
          {!splitLocked && (
          <>
          <OrderTotals
            subtotal={base}
            grossSubtotal={round2(food + applied)}
            discount={discount}
            serviceFee={0}
            tip={tip}
            tipPct={tipCustom !== null ? 0 : tipPct}
            total={total}
            servicePct={0}
            taxPct={Number(restaurant.tax_pct) || 0}
            taxBreakdown={Boolean(restaurant.tax_show_breakdown)}
            currency={currency}
          />
          </>
          )}

          {called ? (
            <div className="tt-bill-called" role="status">
              <strong>{t("bill.called")}</strong>
              <p className="tt-muted tt-subline" style={{ fontSize: 13, margin: 0 }}>
                {t("bill.calledBody")}
              </p>
            </div>
          ) : (
            <div className="tt-bill-actions">
              {/* A bill somebody else is collecting is settled with them. Said
                  plainly, with the one button that does anything, rather than
                  a card field that would be refused after they had typed
                  their number in — and said at all, because a card button
                  that is simply missing leaves them looking for it. */}
              {alone ? (
                <p className="tt-muted tt-subline" style={{ fontSize: 13, marginTop: 0 }}>
                  {/* Why there is no card button. Three reasons reach here and
                      they send the diner to do different things: pay their
                      share, wait for the waiter already coming, or call one. */}
                  {t(splitLocked ? "bill.dividing" : (noCard as string))}
                </p>
              ) : (
                <button
                  className="tt-btn tt-btn-primary tt-btn-lg"
                  style={{ width: "100%" }}
                  disabled={busy}
                  onClick={payOnline}
                >
                  {/* The pair of buttons is a choice between two ways to
                      settle, so each one names its way: online, or with whoever
                      is serving. The amount is on the total line directly
                      above, and repeating it here made the buttons read as
                      "pay" versus something else. */}
                  {busy ? t("cart.redirecting") : t("bill.payNow")}
                </button>
              )}
              <button
                className={`tt-btn tt-btn-lg ${alone ? "tt-btn-primary" : "tt-btn-ghost"}`}
                style={{ width: "100%", marginTop: alone ? 0 : 8 }}
                disabled={busy}
                onClick={payAtTable}
              >
                {busy ? t("bill.calling") : t("bill.payAtTable")}
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

