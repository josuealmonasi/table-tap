import { formatMoney } from "@/lib/format";

/** Subtotal / service charge / total summary card. */
export default function OrderTotals({
  subtotal,
  serviceFee,
  tip,
  tipPct,
  total,
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
  servicePct: number;
  /** IVA %, already included in the item prices (0 = none). */
  taxPct: number;
  /** Split the item subtotal into net + IVA lines. */
  taxBreakdown: boolean;
  currency: string;
}) {
  // Prices include IVA, so the split is informational: net = subtotal / (1+r).
  const showTax = taxBreakdown && taxPct > 0;
  const net = showTax ? subtotal / (1 + taxPct / 100) : subtotal;
  const iva = subtotal - net;

  return (
    <div className="tt-card" style={{ padding: 16 }}>
      <div className="tt-row">
        <span className="tt-muted">{showTax ? "Subtotal (excl. IVA)" : "Subtotal"}</span>
        <span>{formatMoney(showTax ? net : subtotal, currency)}</span>
      </div>
      {showTax && (
        <div className="tt-row" style={{ marginTop: 8 }}>
          <span className="tt-muted">IVA ({taxPct}%)</span>
          <span>{formatMoney(iva, currency)}</span>
        </div>
      )}
      {servicePct > 0 && (
        <div className="tt-row" style={{ marginTop: 8 }}>
          <span className="tt-muted">Service ({servicePct}%)</span>
          <span>{formatMoney(serviceFee, currency)}</span>
        </div>
      )}
      {tip > 0 && (
        <div className="tt-row" style={{ marginTop: 8 }}>
          <span className="tt-muted">Tip{tipPct > 0 ? ` (${tipPct}%)` : ""}</span>
          <span>{formatMoney(tip, currency)}</span>
        </div>
      )}
      <div className="tt-row tt-total">
        <span>Total</span>
        <span className="tt-accent">{formatMoney(total, currency)}</span>
      </div>
    </div>
  );
}
