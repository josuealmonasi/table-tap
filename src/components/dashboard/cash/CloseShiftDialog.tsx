"use client";

import { useRef, useState } from "react";
import { useRetryIntent, refusalSettles } from "@/hooks/useRetryIntent";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";

interface CloseShiftDialogProps {
  open: boolean;
  currency: string;
  shiftId?: string;
  onClose: () => void;
  /** The shift closed (and, if it needed one, was explained). */
  onClosed: () => void;
}

interface Closed {
  currency: string;
  id: string;
  expected: number;
  counted: number;
  difference: number;
}

/**
 * Closing a shift is a blind count. The person closing counts the drawer and
 * enters the amount, confirms the count is theirs, and only then is told what
 * the drawer should have held — the shift is already closed on their number
 * by the time they see it, so the count cannot drift toward the answer. A
 * difference is explained there and then, while they remember why.
 */
export default function CloseShiftDialog({ open, currency, shiftId, onClose, onClosed }: CloseShiftDialogProps) {
  const t = useT();
  const attempt = useRetryIntent();
  const inFlight = useRef(false);
  const [reviewedShift, setReviewedShift] = useState(shiftId);
  const toast = useToast();
  const [counted, setCounted] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [closed, setClosed] = useState<Closed | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);
  const money = (n: number) => formatMoney(n, closed?.currency ?? currency);

  // Each time it opens it starts at the count.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReviewedShift(shiftId);
      setCounted("");
      setConfirmed(false);
      setClosed(null);
      setNote("");
      setError(null);
    }
  }

  async function post(body: object): Promise<Record<string, unknown> | null> {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cash-shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "action" in body && body.action === "close" ? attempt.body(body) : JSON.stringify(body),
      });
      const data = await res.json();
      if ((res.ok && data.ok) || (!res.ok && refusalSettles(res.status))) attempt.clear();
      if (!res.ok) {
        setError(data.error ?? t("apiErr.generic"));
        return null;
      }
      return data;
    } catch {
      setError(t("done.networkError"));
      return null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function count(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const data = await post({ action: "close", shiftId: reviewedShift, counted, confirm: confirmed });
    if (!data) return;
    setClosed({
      id: String(data.id),
      currency: String(data.currency),
      expected: Number(data.expected),
      counted: Number(data.counted),
      difference: Number(data.difference),
    });
  }

  async function explain(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!closed) return;
    const data = await post({ action: "explain", id: closed.id, note });
    if (!data) return;
    toast(t("shift.explained"));
    finish();
  }

  function finish(): void {
    onClosed();
    onClose();
  }

  // Once closed, shutting the dialog any way at all is "done": the shift is
  // closed whether or not anybody presses the button.
  const shut = closed ? finish : onClose;
  const off = closed ? Math.abs(closed.difference) >= 0.01 : false;

  return (
    <Modal open={open} onClose={shut} maxWidth={440} title={t("shift.closeTitle")}>
      {!closed ? (
        <form className="tt-prodform" onSubmit={e => void count(e)}>
          <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>{t("shift.countHint")}</p>
          <label className="tt-field">
            <span className="tt-mod-label">{t("shift.counted")} · {currency}</span>
            <input
              className="tt-input"
              inputMode="decimal"
              value={counted}
              onChange={e => setCounted(e.target.value)}
              placeholder="0.00"
              autoFocus
              required
            />
          </label>
          <label className="tt-check">
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
            <span>{t("shift.confirm")}</span>
          </label>
          {error && <p className="tt-field-error" role="alert">{error}</p>}
          <div className="tt-prodform-actions">
            <button type="submit" className="tt-btn tt-btn-primary" disabled={busy || !counted.trim() || !confirmed}>
              {busy ? t("common.saving") : t("shift.closeAction")}
            </button>
            <button type="button" className="tt-btn tt-btn-ghost" onClick={onClose}>{t("menu.cancel")}</button>
          </div>
        </form>
      ) : (
        <form className="tt-prodform" onSubmit={e => void explain(e)}>
          <div className="tt-cashbox-sum" role="table" aria-label={t("shift.closeTitle")}>
            <div className="tt-cashbox-line" role="row">
              <span role="cell">{t("shift.countedLabel")}</span>
              <span role="cell">{money(closed.counted)}</span>
            </div>
            <div className="tt-cashbox-line" role="row">
              <span role="cell">{t("corte.expected")}</span>
              <span role="cell">{money(closed.expected)}</span>
            </div>
            <div className="tt-cashbox-line tt-cashbox-total" role="row">
              <strong role="cell">
                {!off ? t("shift.exact") : closed.difference > 0 ? t("shift.over") : t("shift.short")}
              </strong>
              <strong role="cell">{off ? money(Math.abs(closed.difference)) : ""}</strong>
            </div>
          </div>
          {off ? (
            <>
              <label className="tt-field">
                <span className="tt-mod-label">{t("shift.explainTitle")}</span>
                <textarea
                  className="tt-input"
                  rows={3}
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  maxLength={280}
                  placeholder={t("shift.explainPlaceholder")}
                  autoFocus
                />
              </label>
              {error && <p className="tt-field-error" role="alert">{error}</p>}
              <div className="tt-prodform-actions">
                <button type="submit" className="tt-btn tt-btn-primary" disabled={busy || !note.trim()}>
                  {busy ? t("common.saving") : t("shift.explainSave")}
                </button>
                <button type="button" className="tt-btn tt-btn-ghost" onClick={finish}>{t("shift.explainLater")}</button>
              </div>
            </>
          ) : (
            <div className="tt-prodform-actions">
              <button type="button" className="tt-btn tt-btn-primary" onClick={finish}>{t("shift.done")}</button>
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
