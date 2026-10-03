"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { badgesChanged } from "@/hooks/useBadges";
import WriteOffDialog from "./WriteOffDialog";
import type { WriteOffReason } from "@/lib/write-off";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import { normalizeCoupon } from "@/lib/coupons";
import { useCouponOptions } from "@/hooks/useCouponOptions";
import CouponCodePicker from "./CouponCodePicker";
import OpenBillSummary from "./OpenBillSummary";
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
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * Closes the bill without collecting for it — a walkout, a courtesy, or an
   * order that should never have been rung up. A waiter's is a request; a
   * manager's is the decision.
   */
  async function writeOff(reason: WriteOffReason, note: string): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/bill/write-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A counter bill has no table, so it names its orders instead.
        body: JSON.stringify({
          tableId: bill.tableId ?? undefined,
          orderIds: bill.tableId ? undefined : bill.orderIds,
          reason,
          note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? null);
        return;
      }
      badgesChanged();
      toast(data.pending ? t("writeOff.sent") : t("writeOff.done"));
      setClosing(false);
      onApplied();
      onClose();
    } finally {
      setBusy(false);
    }
  }
  const [error, setError] = useState<string | null>(null);

  const coupons = useCouponOptions(open, bill.total);

  function pick(next: string): void {
    setCode(next);
    setError(null);
  }

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
    <>
      {/* One dialog at a time. Asking why a bill is being cancelled replaces
          this one rather than stacking over it — two open dialogs trap focus
          against each other and take two Escapes to leave. */}
      <Modal
        open={open && !closing}
        onClose={onClose}
        maxWidth={460}
        label={t("dash.billApply")}
      >
        <OpenBillSummary bill={bill} currency={currency} />

        {bill.discounted ? (
          <p className="tt-muted" style={{ marginTop: 14 }}>
            {t("dash.billAlreadyDiscounted")}
          </p>
        ) : (
          <form onSubmit={submit} style={{ marginTop: 16 }}>
            <CouponCodePicker
              code={code}
              onCode={pick}
              options={coupons.options}
              loading={coupons.loading}
              failed={coupons.failed}
              currency={currency}
            />
            {error && (
              <p className="tt-field-error" style={{ margin: "8px 0 0" }}>
                {error}
              </p>
            )}
            {/* All three on one row: closing the bill on the left, what this
                form does on the right. It used to hang on its own line against
                the opposite edge from the other two. They sit as far apart as
                the row allows, which is what keeps a thumb off the wrong one. */}
            <div className="tt-prodform-actions" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="tt-btn tt-btn-ghost tt-btn-sm tt-bill-close"
                onClick={() => setClosing(true)}
              >
                {canApprove ? t("writeOff.title") : t("writeOff.request")}
              </button>
              <button
                type="submit"
                className="tt-btn tt-btn-primary tt-btn-sm"
                disabled={busy || !code.trim()}
              >
                {canApprove ? t("dash.billApplyCta") : t("dash.billRequestCta")}
              </button>
              <button
                type="button"
                className="tt-btn tt-btn-ghost tt-btn-sm"
                onClick={onClose}
              >
                {t("menu.cancel")}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <WriteOffDialog
        open={closing}
        onClose={() => setClosing(false)}
        amount={bill.total}
        currency={currency}
        canApprove={canApprove}
        busy={busy}
        onSubmit={writeOff}
      />
    </>
  );
}
