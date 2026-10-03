"use client";

import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import TipPicker from "@/components/customer/TipPicker";
import type { PosSaleDetails } from "@/hooks/usePosSaleDetails";

interface PosAskProps {
  details: PosSaleDetails;
  total: number;
  /** The most a tip may be: the food. */
  subtotal: number;
  currency: string;
  canEmailReceipt: boolean;
  busy: boolean;
  /** Everything in it comes off a shelf: it is finished, not sent to a cook. */
  allHandedOver: boolean;
  onClose: () => void;
  onSend: () => void;
}

/**
 * Who it is for, and where the receipt goes — asked once, at the moment the
 * cashier is already speaking to them, and kept out of the sale panel where
 * it was three fields of dead space on every sale.
 *
 * The button sends the order; the backdrop only closes, because an accidental
 * click must never take money.
 */
export default function PosAsk({
  details,
  total,
  subtotal,
  currency,
  canEmailReceipt,
  busy,
  allHandedOver,
  onClose,
  onSend,
}: PosAskProps) {
  const t = useT();
  const d = details;
  return (
    <div className="tt-detail-overlay" onClick={onClose}>
      <div className="tt-pos-ask" onClick={e => e.stopPropagation()}>
        <h3 className="tt-serif" style={{ marginTop: 0 }}>
          {t("pos.askTitle", { amount: formatMoney(total, currency) })}
        </h3>

        {/* The same chips a diner sees, so the two screens cannot offer
            different tips on the same menu. */}
        <div className="tt-pos-tip">
          <TipPicker
            currency={currency}
            tipPct={d.tipCustom !== null ? 0 : d.tipPct}
            tipCustom={d.tipCustom}
            maxTip={subtotal}
            onPresetTip={pct => {
              d.setTipCustom(null);
              d.setTipPct(pct);
            }}
            onCustomTip={amount => {
              d.setTipCustom(amount);
              if (amount !== null) d.setTipPct(0);
            }}
          />
        </div>

        <label className="tt-field">
          <span className="tt-mod-label">{t("pos.customerName")}</span>
          <input
            className="tt-input"
            autoFocus
            value={d.customerName}
            onChange={e => d.setCustomerName(e.target.value)}
            placeholder={t("pos.customerNameHint")}
          />
        </label>

        <label className="tt-field">
          <span className="tt-mod-label">{t("pos.note")}</span>
          <input
            className="tt-input"
            value={d.note}
            onChange={e => d.setNote(e.target.value)}
            placeholder={t("pos.noteHint")}
          />
        </label>

        {/* Not a second way to pay — a modifier on the one there is. The
            customer said no thank you, so there is nowhere to send a
            receipt and nothing to print, and the address field goes away
            rather than sitting there asking a question that no longer has
            a point. */}
        <label className="tt-pos-noticket">
          <input
            type="checkbox"
            checked={d.noTicket}
            disabled={busy}
            onChange={e => d.setNoTicket(e.target.checked)}
          />
          <span>{t("pos.noTicket")}</span>
        </label>

        {d.noTicket ? (
          <p className="tt-muted" style={{ fontSize: 13, margin: "0 0 4px" }}>
            {t("pos.noTicketHint")}
          </p>
        ) : canEmailReceipt ? (
          <label className="tt-field">
            <span className="tt-mod-label">{t("pos.receiptEmail")}</span>
            <input
              className="tt-input"
              type="email"
              value={d.email}
              onChange={e => d.setEmail(e.target.value)}
              placeholder={t("pos.receiptEmailHint")}
            />
          </label>
        ) : (
          <p className="tt-muted" style={{ fontSize: 13 }}>
            {t("pos.receiptPrintOnly")}
          </p>
        )}

        {/* One way forward. Filled in or left blank, this sends the order —
            a second button offering the same thing with a different name
            is a choice nobody has to make. Clicking outside closes and
            changes nothing, so a stray click never takes money. */}
        <div className="tt-pos-ask-actions">
          <button
            type="button"
            className="tt-btn tt-btn-primary"
            disabled={busy}
            onClick={onSend}
          >
            {busy
              ? t("cart.placingOrder")
              : allHandedOver
                ? t("pos.finishSale")
                : t("pos.sendToKitchen")}
          </button>
        </div>
      </div>
    </div>
  );
}
