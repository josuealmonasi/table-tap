"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { badgesChanged } from "@/hooks/useBadges";
import WriteOffDialog from "./WriteOffDialog";
import type { WriteOffReason } from "@/lib/write-off";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import { normalizeCoupon } from "@/lib/coupons";
import { Skeleton } from "@/components/ui/Skeleton";
import type { OpenBill } from "@/lib/open-bills";

/** A promotion the floor may apply to this bill, priced against it. */
interface CouponOption {
  code: string;
  kind: "percent" | "fixed";
  value: number;
  amount: number;
  remaining: number | null;
}

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

  // The promotions that would actually apply to this bill, from the server —
  // the floor shouldn't have to remember codes, or leave the table to go and
  // read the promotions page.
  const [options, setOptions] = useState<CouponOption[]>([]);
  // The list arrives a moment after the dialog does. Its space is held from
  // the start: a modal that grows under a finger already on its way down is
  // how somebody applies a promotion they never chose.
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoadingOptions(true);
    fetch(`/api/bill/discount/options?total=${bill.total}`)
      .then(r => (r.ok ? r.json() : { options: [] }))
      .then(d => setOptions(d.options ?? []))
      .catch(() => setOptions([]))
      .finally(() => setLoadingOptions(false));
  }, [open, bill.total]);

  const shown = useMemo(() => {
    const q = code.trim().toLowerCase();
    return options.filter(o => !q || o.code.toLowerCase().includes(q));
  }, [options, code]);

  useEffect(() => setHighlight(0), [code]);

  function choose(option: CouponOption): void {
    setCode(option.code);
    setError(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (shown.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(h => {
        const next = e.key === "ArrowDown" ? h + 1 : h - 1;
        return (next + shown.length) % shown.length;
      });
    } else if (e.key === "Enter" && shown[highlight] && shown[highlight].code !== code) {
      // Enter picks the highlighted code first; a second Enter submits it.
      e.preventDefault();
      choose(shown[highlight]);
    }
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
        <h3 className="tt-serif" style={{ marginTop: 0 }}>
          {bill.tableLabel
            ? t("dash.tableN", { label: bill.tableLabel })
            : t("dash.billsToGo")}
        </h3>

        {bill.items.map((item, i) => (
          <div key={i} className="tt-row tt-muted" style={{ fontSize: 14, marginTop: 6 }}>
            <span>
              {item.qty}× {item.name}
            </span>
            <span>{formatMoney(item.price * item.qty, currency)}</span>
          </div>
        ))}

        {/* When a promotion is already on this bill the lines add up to more
          than the total, so the difference is named rather than left for the
          waiter to explain to the table. Same three rows the diner sees. */}
        {bill.discount > 0 && (
          <>
            <div className="tt-row" style={{ marginTop: 12, fontSize: 14 }}>
              <span className="tt-muted">{t("totals.subtotal")}</span>
              <span className="tt-muted">
                {formatMoney(bill.total + bill.discount, currency)}
              </span>
            </div>
            <div className="tt-row" style={{ marginTop: 4, fontSize: 14 }}>
              <span className="tt-save">{t("totals.discount")}</span>
              <span className="tt-save">−{formatMoney(bill.discount, currency)}</span>
            </div>
          </>
        )}

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
              placeholder={t("dash.billCodePick")}
              role="combobox"
              aria-expanded={shown.length > 0}
              aria-controls="tt-bill-code-list"
              autoComplete="off"
              onChange={e => {
                setCode(e.target.value.toUpperCase());
                setError(null);
              }}
              onKeyDown={onKeyDown}
              autoFocus
            />

            {/* In flow, not floating: the modal is a scroll container, and an
              absolutely positioned menu inside one gets clipped by it — the
              bug we hit the last time a dropdown lived in a dialog. A list
              that pushes the content simply scrolls with it. */}
            {loadingOptions && (
              <div className="tt-code-list" aria-hidden="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="tt-code-option">
                    <span className="tt-code-name">
                      <Skeleton width={92} height={14} />
                      <Skeleton width={130} height={11} />
                    </span>
                    <Skeleton width={62} height={14} />
                  </div>
                ))}
              </div>
            )}

            {!loadingOptions && (
              <div
                className="tt-code-list"
                id="tt-bill-code-list"
                role="listbox"
                ref={listRef}
              >
                {shown.length === 0 && (
                  <p
                    className="tt-muted"
                    style={{ margin: 0, padding: "14px 12px", fontSize: 13 }}
                  >
                    {t("dash.billCodeNone")}
                  </p>
                )}
                {shown.map((option, i) => (
                  <button
                    key={option.code}
                    type="button"
                    role="option"
                    aria-selected={option.code === code}
                    className={`tt-code-option ${i === highlight ? "tt-code-option-on" : ""}`}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => choose(option)}
                  >
                    <span className="tt-code-name">
                      <strong>{option.code}</strong>
                      <span className="tt-muted tt-subline" style={{ fontSize: 12 }}>
                        {option.kind === "percent"
                          ? t("dash.billCodePct", { pct: String(option.value) })
                          : t("dash.billCodeFixed", {
                              amount: formatMoney(option.value, currency),
                            })}
                        {option.remaining !== null
                          ? ` · ${t("dash.billCodeLeft", { n: String(option.remaining) })}`
                          : ""}
                      </span>
                    </span>
                    <strong className="tt-accent" style={{ flex: "none" }}>
                      −{formatMoney(option.amount, currency)}
                    </strong>
                  </button>
                ))}
              </div>
            )}
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
