"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateLocale, formatMoney } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import { useToast } from "@/components/ui/Toast";
import { needsExplanation, type ShiftView } from "@/lib/cash-shift";
import ShiftTrail from "./ShiftTrail";

interface ShiftRecordProps {
  view: ShiftView;
  timeZone: string;
  restaurantName: string;
}

/**
 * A closed shift as a manager reviews it: the sum it was counted against,
 * the count, the difference and why, and the trail of what happened to the
 * money — printable as the sheet two people sign at a handover.
 */
export default function ShiftRecord({ view, timeZone, restaurantName }: ShiftRecordProps) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const { shift, sum, trail } = view;
  const [showTrail, setShowTrail] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const money = (n: number) => formatMoney(n, shift.currency);
  const time = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(dateLocale(locale), { timeZone, dateStyle: "short", timeStyle: "short" }) : "";
  const difference = Number(shift.difference ?? 0);
  const off = Math.abs(difference) >= 0.01;
  const verdict = !off ? t("shift.exact") : difference > 0 ? t("shift.over") : t("shift.short");
  // Money dated inside the shift that reached the server after it was
  // counted — a sale the till held offline and sent later. The sign-off stays
  // what it was; what it means now is shown under it. Without this the record
  // went on saying "MX$100 over" for a drawer that, with the late sale, was
  // exactly right.
  const saved = shift.expected_cash === null ? null : Number(shift.expected_cash);
  const late = saved === null ? 0 : Math.round((sum.expected - saved) * 100) / 100;
  const hasLate = Math.abs(late) >= 0.01;
  const nowDifference = Math.round((Number(shift.counted_cash ?? 0) - sum.expected) * 100) / 100;
  const nowOff = Math.abs(nowDifference) >= 0.01;
  const nowVerdict = t("shift.now", {
    verdict: !nowOff ? t("shift.exact") : nowDifference > 0 ? t("shift.over") : t("shift.short"),
  });
  const lateAmount = `${late > 0 ? "+" : "−"}${money(Math.abs(late))}`;

  async function explain(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/cash-shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "explain", id: shift.id, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast(data.error ?? t("done.networkError"), "error");
      else {
        toast(t("shift.explained"));
        setExplaining(false);
        router.refresh();
      }
    } catch {
      toast(t("done.networkError"), "error");
    } finally {
      setBusy(false);
    }
  }

  /** The handover sheet: the sum, the count, the trail, two signatures. */
  function print(): void {
    const row = (label: string, value: string, strong = false) =>
      `<tr${strong ? ' style="font-weight:700"' : ""}><td style="padding:3px 24px 3px 0">${escapeHtml(label)}</td><td style="text-align:right">${escapeHtml(value)}</td></tr>`;
    const w = window.open("", "_blank", "width=720,height=900");
    if (!w) return;
    const trailRows = trail
      .map(l => `<li>${escapeHtml(time(l.created_at))} · ${escapeHtml(l.actor_email ?? "")} · ${escapeHtml(t(`log.${l.entity}.${l.action}`))}</li>`)
      .join("");
    w.document.write(
      `<!doctype html><title>${escapeHtml(t("shift.sheetTitle"))}</title>` +
        `<body style="font-family:system-ui,sans-serif;padding:28px;color:#111113">` +
        `<h1 style="margin:0;font-size:20px">${escapeHtml(t("shift.sheetTitle"))}</h1>` +
        `<p style="margin:4px 0 18px;color:#70707a">${escapeHtml(restaurantName)} · ${escapeHtml(time(shift.opened_at))}–${escapeHtml(time(shift.closed_at))}</p>` +
        `<p style="font-size:14px">${escapeHtml(t("shift.openedBy", { who: shift.opened_by }))} · ${escapeHtml(t("shift.closedBy", { who: shift.closed_by ?? "" }))}</p>` +
        `<table style="font-size:14px;border-collapse:collapse;margin:12px 0">` +
        row(t("corte.opening"), money(sum.opening)) +
        row(`+ ${t("corte.cashSales")}`, money(sum.cashSales)) +
        row(`− ${t("corte.withdrawals")}`, money(sum.withdrawn)) +
        row(t("corte.expected"), money(Number(shift.expected_cash ?? sum.expected)), true) +
        row(t("shift.countedLabel"), money(Number(shift.counted_cash ?? 0)), true) +
        row(verdict, off ? money(Math.abs(difference)) : "", true) +
        (hasLate
          ? row(t("shift.lateArrived"), lateAmount) + row(nowVerdict, nowOff ? money(Math.abs(nowDifference)) : "", true)
          : "") +
        `</table>` +
        (shift.difference_note ? `<p style="font-size:14px">${escapeHtml(t("shift.why"))}: ${escapeHtml(shift.difference_note)}</p>` : "") +
        `<h2 style="font-size:15px;margin-top:20px">${escapeHtml(t("shift.trail"))}</h2>` +
        (trailRows ? `<ul style="font-size:13px">${trailRows}</ul>` : `<p style="font-size:13px">${escapeHtml(t("shift.trailEmpty"))}</p>`) +
        `<div style="display:flex;gap:48px;margin-top:56px;font-size:13px;color:#70707a">` +
        `<div style="border-top:1px solid #111113;width:220px;padding-top:6px">${escapeHtml(t("shift.signGave"))}</div>` +
        `<div style="border-top:1px solid #111113;width:220px;padding-top:6px">${escapeHtml(t("shift.signGot"))}</div>` +
        `</div></body>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div className="tt-shift">
      <div className="tt-cashbox-head">
        <span>
          <strong>{time(shift.opened_at)}–{time(shift.closed_at)}</strong>{" "}
          <span className="tt-muted">· {t("shift.closedBy", { who: shift.closed_by ?? "" })}</span>
        </span>
        <div className="tt-cashbox-actions">
          <button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setShowTrail(s => !s)} aria-expanded={showTrail}>
            {t("shift.trail")}
          </button>
          <button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={print}>{t("shift.print")}</button>
        </div>
      </div>

      <div className="tt-cashbox-sum" role="table" aria-label={t("shift.sheetTitle")}>
        <div className="tt-cashbox-line" role="row">
          <span role="cell">{t("corte.expected")}</span>
          <span role="cell">{money(Number(shift.expected_cash ?? sum.expected))}</span>
        </div>
        <div className="tt-cashbox-line" role="row">
          <span role="cell">{t("shift.countedLabel")}</span>
          <span role="cell">{money(Number(shift.counted_cash ?? 0))}</span>
        </div>
        <div className={`tt-cashbox-line tt-cashbox-total${off ? " tt-shift-off" : ""}`} role="row">
          <strong role="cell">{verdict}</strong>
          <strong role="cell">{off ? money(Math.abs(difference)) : ""}</strong>
        </div>
        {hasLate && (
          <>
            <div className="tt-cashbox-line" role="row">
              <span role="cell">{t("shift.lateArrived")}</span>
              <span role="cell">{lateAmount}</span>
            </div>
            <div className={`tt-cashbox-line tt-cashbox-total${nowOff ? " tt-shift-off" : ""}`} role="row">
              <strong role="cell">{nowVerdict}</strong>
              <strong role="cell">{nowOff ? money(Math.abs(nowDifference)) : ""}</strong>
            </div>
          </>
        )}
      </div>

      {shift.difference_note && (
        <p className="tt-shift-why">
          <span className="tt-muted">{t("shift.why")}:</span> {shift.difference_note}
        </p>
      )}
      {needsExplanation(shift) && !explaining && (
        <p className="tt-shift-why">
          <span className="tt-shift-flag">{t("shift.needsExplain")}</span>{" "}
          <button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setExplaining(true)}>{t("shift.explain")}</button>
        </p>
      )}
      {explaining && (
        <form className="tt-shift-explain" onSubmit={e => void explain(e)}>
          <textarea
            className="tt-input"
            rows={2}
            maxLength={280}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={t("shift.explainPlaceholder")}
            aria-label={t("shift.explainTitle")}
            autoFocus
          />
          <div className="tt-cashbox-actions">
            <button type="submit" className="tt-btn tt-btn-primary tt-btn-sm" disabled={busy || !note.trim()}>
              {t("shift.explainSave")}
            </button>
            <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setExplaining(false)}>
              {t("menu.cancel")}
            </button>
          </div>
        </form>
      )}
      {showTrail && <ShiftTrail trail={trail} currency={shift.currency} timeZone={timeZone} />}
    </div>
  );
}
