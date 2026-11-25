"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateLocale, formatMoney } from "@/lib/format";
import { otherCurrencyLines } from "@/lib/other-currency";
import { pendingWithdrawn } from "@/lib/cash-drawer";
import { shiftOtherCurrencies, type ShiftView } from "@/lib/cash-shift";
import CashMovementDialog from "./CashMovementDialog";
import CloseShiftDialog from "./CloseShiftDialog";
import ShiftRecord from "./ShiftRecord";
import WithdrawalList from "./WithdrawalList";

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
  const [dialog, setDialog] = useState<"opening" | "withdrawal" | "close" | null>(null);
  const current = shifts.find(v => v.shift.closed_at === null) ?? null;
  const drawerCurrency = current?.shift.currency ?? currency;
  const money = (n: number) => formatMoney(n, drawerCurrency);
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(dateLocale(locale), { timeZone, hour: "2-digit", minute: "2-digit" });
  const closed = shifts.filter(v => v.shift.closed_at !== null).reverse();
  const pending = current ? pendingWithdrawn(current.withdrawals) : 0;

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
            {Number(current.sum.tips) > 0 && <div className="tt-cashbox-line tt-muted" role="row">
              <span role="cell">{t("corte.cashTips")}</span>
              <span role="cell">{money(Number(current.sum.tips))}</span>
            </div>}
            {Number(current.sum.tips_out) > 0 && <div className="tt-cashbox-line tt-muted" role="row">
              <span role="cell">{t("corte.tipsOut")}</span>
              <span role="cell">{money(Number(current.sum.tips_out))}</span>
            </div>}
            {Number(current.sum.unclassifiedCash) > 0 && <div className="tt-cashbox-line" role="row">
              <span role="cell">+ {t("corte.unclassifiedCash")}</span>
              <span role="cell">{money(Number(current.sum.unclassifiedCash))}</span>
            </div>}
            <div className="tt-cashbox-line" role="row">
              <span role="cell">− {t("corte.withdrawals")}</span>
              <span role="cell">{money(current.sum.withdrawn)}</span>
            </div>
            {/* Recorded by a cashier, not yet approved: shown, never subtracted. */}
            {pending > 0 && <div className="tt-cashbox-line tt-muted" role="row">
              <span role="cell">{t("corte.pendingWithdrawals")}</span>
              <span role="cell">{money(pending)}</span>
            </div>}
            <div className="tt-cashbox-line tt-cashbox-total" role="row">
              <strong role="cell">{t("corte.expected")}</strong>
              <strong role="cell">{money(current.sum.expected)}</strong>
            </div>
          </div>
          {otherCurrencyLines(shiftOtherCurrencies(current), t, formatMoney).map(line => (
            <p key={line} className="tt-muted tt-costs-hint">{line}</p>
          ))}
          <WithdrawalList withdrawals={current.withdrawals} time={time} />
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
        shiftId={current?.shift.id}
        currency={dialog === "opening" ? currency : drawerCurrency}
        onClose={() => setDialog(null)}
        onSaved={() => router.refresh()}
      />
      <CloseShiftDialog
        open={dialog === "close"}
        shiftId={current?.shift.id}
        currency={drawerCurrency}
        onClose={() => setDialog(null)}
        onClosed={() => router.refresh()}
      />
    </div>
  );
}
