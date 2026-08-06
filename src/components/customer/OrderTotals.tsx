"use client";

import { formatMoney } from "@/lib/format";
import { ivaSplit } from "@/lib/money";
import { useT } from "@/lib/i18n/context";

/** Subtotal / service charge / total summary card. */
export default function OrderTotals({
  subtotal,
  serviceFee,
  tip,
  tipPct,
  total,
  discount = 0,
  grossSubtotal,
  servicePct,
  taxPct,
  taxBreakdown,
  currency,
}: {
  subtotal: number;
  serviceFee: number;
  tip: number;
  tipPct: number;
  total: number;
  /** Everything taken off: item sale prices, promos and any coupon. */
  discount?: number;
  /** Item total before discounts — only needed when `discount` is above 0. */
  grossSubtotal?: number;
  servicePct: number;
  /** IVA %, already included in the item prices (0 = none). */
  taxPct: number;
  /** Split the item subtotal into net + IVA lines. */
  taxBreakdown: boolean;
  currency: string;
}) {
  const t = useT();
  // Prices include IVA, so the split is informational: net = subtotal / (1+r).
  const showTax = taxBreakdown && taxPct > 0;
  const { net, iva } = ivaSplit(subtotal, showTax ? taxPct : 0);

  const saved = discount > 0;
  return (
    <div className="tt-card" style={{ padding: 16 }}>
      {/* With a discount, lead with what the items cost and show the saving as
          its own line, so the customer can see where the money came off. */}
      {saved && (
        <>
          <div className="tt-row">
            <span className="tt-muted">{t("totals.subtotal")}</span>
            <span>{formatMoney(grossSubtotal ?? subtotal, currency)}</span>
          </div>
          <div className="tt-row" style={{ marginTop: 8 }}>
            <span className="tt-save">{t("totals.discount")}</span>
            <span className="tt-save">−{formatMoney(discount, currency)}</span>
          </div>
        </>
      )}
      {/* Skip this when a discount already showed the plain subtotal above and
          there's no tax split to add — otherwise "Subtotal" appears twice. */}
      {(!saved || showTax) && (
        <div className="tt-row" style={{ marginTop: saved ? 8 : 0 }}>
          <span className="tt-muted">
            {t(showTax ? "totals.subtotalExclIva" : "totals.subtotal")}
          </span>
          <span>{formatMoney(showTax ? net : subtotal, currency)}</span>
        </div>
      )}
      {showTax && (
        <div className="tt-row" style={{ marginTop: 8 }}>
          <span className="tt-muted">{t("totals.iva", { pct: taxPct })}</span>
          <span>{formatMoney(iva, currency)}</span>
        </div>
      )}
      {servicePct > 0 && (
        <div className="tt-row" style={{ marginTop: 8 }}>
          <span className="tt-muted">{t("totals.service", { pct: servicePct })}</span>
          <span>{formatMoney(serviceFee, currency)}</span>
        </div>
      )}
      {tip > 0 && (
        <div className="tt-row" style={{ marginTop: 8 }}>
          <span className="tt-muted">
            {tipPct > 0 ? t("totals.tipPct", { pct: tipPct }) : t("totals.tip")}
          </span>
          <span>{formatMoney(tip, currency)}</span>
        </div>
      )}
      <div className="tt-row tt-total">
        <span>{t("totals.total")}</span>
        <span className="tt-price">{formatMoney(total, currency)}</span>
      </div>
    </div>
  );
}
