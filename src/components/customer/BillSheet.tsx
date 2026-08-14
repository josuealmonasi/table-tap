"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { canPayMineOnly, ordersToPay, type BillSide, type TableBill } from "@/lib/table-bill";
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
}

/** One dish on the bill, laid out like a cart line but not editable. */
function BillLine({
  name,
  emoji,
  qty,
  price,
  currency,
}: {
  name: string;
  emoji: string;
  qty: number;
  price: number;
  currency: string;
}) {
  return (
    <div className="tt-card" style={{ padding: 14 }}>
      <div className="tt-line">
        <span style={{ fontSize: 28 }}>{emoji || "🍽️"}</span>
        <div className="tt-line-body">
          <strong>
            {qty}× {name}
          </strong>
        </div>
        <div className="tt-line-actions">
          <strong className="tt-accent">{formatMoney(price * qty, currency)}</strong>
        </div>
      </div>
    </div>
  );
}

function Section({ heading, side, currency }: { heading: string; side: BillSide; currency: string }) {
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
          qty={item.qty}
          price={item.price}
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
 * There is no coupon box on purpose. These orders were priced when they were
 * placed, with whatever coupon applied then; taking a second one here would
 * discount the same food twice.
 */
export default function BillSheet({
  open,
  onClose,
  bill,
  restaurant,
  tableId,
  tableLabel,
}: BillSheetProps) {
  const t = useT();
  const currency = restaurant.currency;
  const [busy, setBusy] = useState(false);
  const [called, setCalled] = useState(false);
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [tipPct, setTipPct] = useState(0);
  const [tipCustom, setTipCustom] = useState<number | null>(null);

  // What the chosen scope comes to, before any tip.
  const base = scope === "mine" ? bill.mine.total : bill.total;
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
          orderIds: ordersToPay(bill, scope).map(o => o.id),
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
          <Section heading={t("bill.yours")} side={bill.mine} currency={currency} />
          <Section heading={t("bill.othersAtTable")} side={bill.others} currency={currency} />

          {/* Paying for the table or only for yourself changes what the totals
              below are counting, so it sits above them. */}
          {canPayMineOnly(bill) && (
            <div className="tt-tip-row" style={{ marginTop: 14 }}>
              <button
                type="button"
                className={`tt-tip-chip ${scope === "all" ? "tt-tip-chip-active" : ""}`}
                onClick={() => setScope("all")}
              >
                {t("bill.scopeAll")}
              </button>
              <button
                type="button"
                className={`tt-tip-chip ${scope === "mine" ? "tt-tip-chip-active" : ""}`}
                onClick={() => setScope("mine")}
              >
                {t("bill.scopeMine")}
              </button>
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
                {busy
                  ? t("cart.redirecting")
                  : t("bill.payNow", { amount: formatMoney(total, currency) })}
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
