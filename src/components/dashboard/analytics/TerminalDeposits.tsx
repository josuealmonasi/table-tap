"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { formatMoney } from "@/lib/format";
import type { DepositDay } from "@/lib/terminal";
import type { TerminalView } from "@/lib/terminal-server";
import { useCostsSend } from "@/hooks/useCostsSend";
import { useDayLabel, useTimeLabel } from "@/hooks/useWhen";
import DepositDialog from "./DepositDialog";

interface TerminalDepositsProps {
  terminal: TerminalView;
  currency: string;
  timeZone: string;
}

/**
 * The restaurant's own card terminal, day by day: what it took, the tips
 * inside that, its fee, and what should reach the bank and when — marked
 * when it does, with any difference shown. Each day opens to its payments
 * and their voucher references, to find the sale a voucher paid.
 */
export default function TerminalDeposits({ terminal, currency, timeZone }: TerminalDepositsProps) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const send = useCostsSend();
  const dayLabel = useDayLabel();
  const timeLabel = useTimeLabel(timeZone);
  const [days, setDays] = useState(String(terminal.settleDays));
  const [open, setOpen] = useState<string | null>(null);
  const [marking, setMarking] = useState<DepositDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const money = (n: number) => formatMoney(n, currency);

  async function saveDays(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const failed = await send("/api/terminal/deposits", "PATCH", { settleDays: days });
    if (failed) return setError(failed);
    router.refresh();
  }

  async function takeBack(day: string): Promise<void> {
    const ok = await confirm({ title: t("terminal.undoConfirm", { day: dayLabel(day) }), confirmLabel: t("terminal.undo"), danger: true });
    if (!ok) return;
    const failed = await send("/api/terminal/deposits", "DELETE", { day });
    toast(failed ?? t("terminal.undone"), failed ? "error" : undefined);
    if (!failed) router.refresh();
  }

  return (
    <section className="tt-section tt-terminal">
      <h3 className="tt-serif" style={{ margin: 0 }}>{t("terminal.title")}</h3>
      <p className="tt-muted tt-costs-hint">
        {t("terminal.hint", { pct: terminal.feePct, days: terminal.settleDays })}
      </p>
      <form className="tt-costs-fee-form" onSubmit={e => void saveDays(e)}>
        <label className="tt-field">
          <span className="tt-mod-label">{t("terminal.settleDays")}</span>
          <input className="tt-input" inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} />
        </label>
        <button type="submit" className="tt-btn tt-btn-ghost tt-btn-sm" disabled={days.trim() === String(terminal.settleDays)}>
          {t("common.save")}
        </button>
      </form>
      {error && <p className="tt-field-error" role="alert">{error}</p>}
      {terminal.days.length === 0 ? (
        <p className="tt-muted">{t("terminal.empty")}</p>
      ) : (
        <ul className="tt-costs-products">
          {terminal.days.map(d => (
            <li key={d.day} className="tt-terminal-day">
              <button type="button" className="tt-terminal-day-head" aria-expanded={open === d.day}
                onClick={() => setOpen(open === d.day ? null : d.day)}>
                <span className="tt-costs-product-name">{dayLabel(d.day)}</span>
                <span className={`tt-costs-chip tt-terminal-${d.status}`}>{t(`terminal.status.${d.status}`)}</span>
                <span className="tt-costs-product-meta tt-muted">
                  {t("terminal.taken", { n: d.count, amount: money(d.takings), tips: money(d.tips) })}
                  {" · "}{t("terminal.fee", { amount: money(d.fee) })}
                  {" · "}{t("terminal.expected", { amount: money(d.expected), day: dayLabel(d.expectedOn) })}
                  {d.deposit && ` · ${t("terminal.received", { amount: money(Number(d.deposit.received)) })}`}
                  {d.deposit && d.status !== "received" && ` (${t("terminal.difference", { amount: money(Number(d.deposit.received) - d.expected) })})`}
                </span>
              </button>
              {open === d.day && (
                <div className="tt-terminal-detail">
                  <ul className="tt-terminal-payments">
                    {(terminal.payments[d.day] ?? []).map(p => (
                      <li key={p.id}>
                        <span>{timeLabel(p.at)}{p.code && ` · ${p.code}`}</span>
                        <span>{money(p.amount)}{p.tip > 0 && ` · ${t("terminal.tip", { amount: money(p.tip) })}`}</span>
                        <span className="tt-muted">{p.ref ?? t("terminal.noRef")}</span>
                      </li>
                    ))}
                  </ul>
                  {d.deposit ? (
                    <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => void takeBack(d.day)}>
                      {t("terminal.undo")}
                    </button>
                  ) : d.count > 0 ? (
                    <button type="button" className="tt-btn tt-btn-primary tt-btn-sm" onClick={() => setMarking(d)}>
                      {t("terminal.mark")}
                    </button>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <DepositDialog day={marking} dayLabel={marking ? dayLabel(marking.day) : ""} currency={currency} onClose={() => setMarking(null)} />
    </section>
  );
}
