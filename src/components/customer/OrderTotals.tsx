import { formatMoney } from "@/lib/format";

/** Subtotal / service charge / total summary card. */
export default function OrderTotals({
  subtotal,
  serviceFee,
  total,
  servicePct,
  currency,
}: {
  subtotal: number;
  serviceFee: number;
  total: number;
  servicePct: number;
  currency: string;
}) {
  return (
    <div className="tt-card" style={{ padding: 16 }}>
      <div className="tt-row">
        <span className="tt-muted">Subtotal</span>
        <span>{formatMoney(subtotal, currency)}</span>
      </div>
      {servicePct > 0 && (
        <div className="tt-row" style={{ marginTop: 8 }}>
          <span className="tt-muted">Service ({servicePct}%)</span>
          <span>{formatMoney(serviceFee, currency)}</span>
        </div>
      )}
      <div className="tt-row tt-total">
        <span>Total</span>
        <span className="tt-accent">{formatMoney(total, currency)}</span>
      </div>
    </div>
  );
}
