"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import { COUPON_PATTERN_HINT, normalizeCoupon } from "@/lib/coupons";
import type { OpenBill } from "@/lib/open-bills";

interface BillDiscountDialogProps {
  open: boolean;
  onClose: () => void;
  bill: OpenBill;
  currency: string;
  /** A waiter may ask for a discount; only a manager grants one. */
  canApprove: boolean;
  onApplied: () => void;
}

/**
 * Applying a promotion to a bill somebody is about to pay.
 *
 * The manager is standing at the table with the diner waiting, so the dialog
 * is the bill and one field. The code is the restaurant's own — the kind that
 * is never printed for customers, applied when someone shows a membership card
 * — and the amount is worked out on the server against the bill as it stands.
 */
export default function BillDiscountDialog({
  open,
  onClose,
  bill,
  currency,
  canApprove,
  onApplied,
}: BillDiscountDialogProps) {
  const t = useT();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bill/discount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: bill.tableId ?? undefined,
          orderId: bill.tableId ? undefined : bill.orderIds[0],
          code: normalizeCoupon(code),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("apiErr.generic"));
        return;
      }
      toast(
        data.pending
          ? t("dash.billRequested")
          : t("dash.billApplied", { amount: formatMoney(data.amount, currency) }),
      );
      setCode("");
      onApplied();
      onClose();
    } catch {
      setError(t("apiErr.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth={460} label={t("dash.billApply")}>
      <h3 className="tt-serif" style={{ marginTop: 0 }}>
        {bill.tableLabel ? t("dash.tableN", { label: bill.tableLabel }) : t("dash.billsToGo")}
      </h3>

      {bill.items.map((item, i) => (
        <div key={i} className="tt-row tt-muted" style={{ fontSize: 14, marginTop: 6 }}>
          <span>
            {item.qty}× {item.name}
          </span>
          <span>{formatMoney(item.price * item.qty, currency)}</span>
        </div>
      ))}

      <div className="tt-row tt-total" style={{ marginTop: 12 }}>
        <span>{t("totals.total")}</span>
        <span>{formatMoney(bill.total, currency)}</span>
      </div>

      {bill.discounted ? (
        <p className="tt-muted" style={{ marginTop: 14 }}>
          {t("dash.billAlreadyDiscounted")}
        </p>
      ) : (
        <form onSubmit={submit} style={{ marginTop: 16 }}>
          <label className="tt-mod-label" htmlFor="tt-bill-code">
            {t("dash.billCodeLabel")}
          </label>
          <input
            id="tt-bill-code"
            className="tt-input"
            style={{ width: "100%", marginTop: 6 }}
            value={code}
            placeholder={COUPON_PATTERN_HINT}
            onChange={e => {
              setCode(e.target.value.toUpperCase());
              setError(null);
            }}
            autoFocus
          />
          {error && (
            <p className="tt-field-error" style={{ margin: "8px 0 0" }}>
              {error}
            </p>
          )}
          <div className="tt-prodform-actions" style={{ marginTop: 14 }}>
            <button
              type="submit"
              className="tt-btn tt-btn-primary tt-btn-sm"
              disabled={busy || !code.trim()}
            >
              {canApprove ? t("dash.billApplyCta") : t("dash.billRequestCta")}
            </button>
            <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={onClose}>
              {t("menu.cancel")}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
