"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateLocale, formatMoney } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { CashMovement } from "@/lib/cash-drawer";
import type { ShiftView } from "@/lib/cash-shift";
import CashMovementDialog from "./CashMovementDialog";
import CloseShiftDialog from "./CloseShiftDialog";
import ShiftRecord from "./ShiftRecord";

interface ShiftBlockProps {
  /** Today's shifts, oldest first; the open one, if any, is last. */
  shifts: ShiftView[];
  currency: string;
  timeZone: string;
  restaurantName: string;
}

/**
 * The cash drawer, shift by shift, as the register close shows it to a
 * manager: the shift open now as the sum it will be counted against —
 * opening, plus the cash taken, minus what was taken out — and every shift
 * closed today with its count, its difference and why.
 *
 * Cash only. Card and online money never sits in a drawer.
 */
export default function ShiftBlock({ shifts, currency, timeZone, restaurantName }: ShiftBlockProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<"opening" | "withdrawal" | "close" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const current = shifts.find(v => v.shift.closed_at === null) ?? null;
  const drawerCurrency = current?.shift.currency ?? currency;
  const money = (n: number) => formatMoney(n, drawerCurrency);
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(dateLocale(locale), { timeZone, hour: "2-digit", minute: "2-digit" });
  const closed = shifts.filter(v => v.shift.closed_at !== null).reverse();

  async function strike(w: CashMovement): Promise<void> {
    const ok = await confirm({
      title: t("corte.removeWithdrawalTitle", { amount: formatMoney(w.amount, w.currency) }),
      message: t("corte.removeWithdrawalMsg"),
      confirmLabel: t("corte.removeWithdrawal"),
    });
    if (!ok) return;
    setBusy(w.id);
    try {
      const res = await fetch("/api/cash-drawer", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: w.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast(data.error ?? t("done.networkError"), "error");
      else {
        toast(t("corte.withdrawalRemoved"));
        router.refresh();
      }
    } catch {
      toast(t("done.networkError"), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="tt-cashbox">
      <div className="tt-cashbox-head">
        <strong>{t("corte.drawer")}</strong>
        <div className="tt-cashbox-actions">
          {current ? (
            <>
              <button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setDialog("withdrawal")}>
                {t("corte.addWithdrawal")}
              </button>
              <button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setDialog("close")}>
                {t("shift.close")}
              </button>
            </>
          ) : (
            <button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setDialog("opening")}>
              {t("shift.open")}
            </button>
          )}
        </div>
      </div>

      {current ? (
        <>
          <p className="tt-muted tt-cashbox-note">
            {t("shift.openNow", { who: current.shift.opened_by, time: time(current.shift.opened_at) })}
          </p>
          {drawerCurrency !== currency && <p className="tt-muted tt-cashbox-note">{t("shift.currencyChanged", { currency: drawerCurrency, current: currency })}</p>}
          <div className="tt-cashbox-sum" role="table" aria-label={t("corte.drawer")}>
            <div className="tt-cashbox-line" role="row">
              <span role="cell">{t("corte.opening")}</span>
              <span role="cell">{money(current.sum.opening)}</span>
            </div>
            <div className="tt-cashbox-line" role="row">
              <span role="cell">+ {t("corte.cashSales")}</span>
              <span role="cell">{money(current.sum.cashSales)}</span>
            </div>
            <div className="tt-cashbox-line" role="row">
              <span role="cell">− {t("corte.withdrawals")}</span>
              <span role="cell">{money(current.sum.withdrawn)}</span>
            </div>
            <div className="tt-cashbox-line tt-cashbox-total" role="row">
              <strong role="cell">{t("corte.expected")}</strong>
              <strong role="cell">{money(current.sum.expected)}</strong>
            </div>
          </div>
          {current.withdrawals.length > 0 && (
            <ul className="tt-cashbox-list">
              {current.withdrawals.map(w => (
                <li key={w.id} className="tt-cashbox-item">
                  <span className="tt-cashbox-what">
                    <strong>{formatMoney(w.amount, w.currency)}</strong>
                    <span className="tt-muted">
                      {time(w.created_at)} · {w.actor_email}
                      {w.note ? ` · ${w.note}` : ""}
                    </span>
                  </span>
                  <button className="tt-btn tt-btn-ghost tt-btn-sm" disabled={busy === w.id} onClick={() => void strike(w)}>
                    {t("corte.removeWithdrawal")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="tt-muted tt-cashbox-note">{t("shift.none")}</p>
      )}

      {closed.length > 0 && (
        <div className="tt-shift-list">
          <strong className="tt-shift-list-title">{t("shift.today")}</strong>
          {closed.map(v => (
            <ShiftRecord key={v.shift.id} view={v} timeZone={timeZone} restaurantName={restaurantName} />
          ))}
        </div>
      )}
      <p className="tt-muted tt-cashbox-note">{t("corte.drawerHint")}</p>

      <CashMovementDialog
        kind={dialog === "opening" || dialog === "withdrawal" ? dialog : null}
        currency={dialog === "opening" ? currency : drawerCurrency}
        onClose={() => setDialog(null)}
        onSaved={() => router.refresh()}
      />
      <CloseShiftDialog
        open={dialog === "close"}
        currency={drawerCurrency}
        onClose={() => setDialog(null)}
        onClosed={() => router.refresh()}
      />
    </div>
  );
}
