"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { canPayMineOnly, ordersToPay, type BillSide, type TableBill } from "@/lib/table-bill";
import { applyCoupon, itemSalePrice } from "@/lib/pricing";
import type { AppliedCoupon } from "@/lib/pricing";
import CouponBox from "./CouponBox";
import DishImage from "./DishImage";
import OrderTotals from "./OrderTotals";
import TipPicker from "./TipPicker";
import type { Restaurant } from "@/lib/types";

interface BillSheetProps {
  open: boolean;
  onClose: () => void;
  bill: TableBill;
  restaurant: Restaurant;
  tableId: string;
  tableLabel: string;
  /** The dish's photo, looked up from the live menu — null falls back to emoji. */
  photoOf: (itemId: string) => string | null;
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
}: {
  heading: string;
  side: BillSide;
  currency: string;
  photoOf: (itemId: string) => string | null;
}) {
  if (side.orders.length === 0) return null;
  return (
    <>
      <div className="tt-mod-label" style={{ marginTop: 4 }}>
        {heading}
      </div>
      {side.items.map((item, i) => (
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
    </>
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
  tableId,
  tableLabel,
  photoOf,
}: BillSheetProps) {
  const t = useT();
  const currency = restaurant.currency;
  const [busy, setBusy] = useState(false);
  const [called, setCalled] = useState(false);
  const [scope, setScope] = useState<"all" | "mine">("all");
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
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setBusy(false);
    } catch {
      setBusy(false);
    }
  }

  // Switching what you're paying for changes the amount the coupon was checked
  // against, so the code is re-entered rather than silently re-priced.
  function changeScope(next: "all" | "mine"): void {
    setScope(next);
    setCoupon(null);
  }

  async function payAtTable(): Promise<void> {
    setBusy(true);
    try {
      await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId: restaurant.id, tableId, kind: "pay" }),
      });
      setCalled(true);
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

          {/* Paying for the table or only for yourself changes what the totals
              below are counting, so it sits above them. */}
          {canPayMineOnly(bill) && (
            <div className="tt-tip-row" style={{ marginTop: 14 }}>
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

          {!alreadyDiscounted && (
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

          {called ? (
            <div className="tt-bill-called" role="status">
              <strong>{t("bill.called")}</strong>
              <p className="tt-muted tt-subline" style={{ fontSize: 13, margin: 0 }}>
                {t("bill.calledBody")}
              </p>
            </div>
          ) : (
            <div className="tt-bill-actions">
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
              <button
                className="tt-btn tt-btn-ghost tt-btn-lg"
                style={{ width: "100%", marginTop: 8 }}
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
