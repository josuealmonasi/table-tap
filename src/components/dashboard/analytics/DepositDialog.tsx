"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import type { DepositDay } from "@/lib/terminal";
import { useCostsSend } from "@/hooks/useCostsSend";

interface DepositDialogProps {
  /** The day being marked, or null when closed. */
  day: DepositDay | null;
  dayLabel: string;
  currency: string;
  onClose: () => void;
}

/** A day's deposit arrived: how much, as the bank statement shows it. */
export default function DepositDialog({ day, dayLabel, currency, onClose }: DepositDialogProps) {
  const t = useT();
  return (
    <Modal open={day !== null} onClose={onClose} maxWidth={420} title={t("terminal.markTitle", { day: dayLabel })}>
      {day && <DepositForm key={day.day} day={day} currency={currency} onClose={onClose} />}
    </Modal>
  );
}

function DepositForm({ day, currency, onClose }: { day: DepositDay; currency: string; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const send = useCostsSend();
  const [received, setReceived] = useState(day.expected.toFixed(2));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const failed = await send("/api/terminal/deposits", "POST", { day: day.day, received, note: note.trim() || undefined });
    setBusy(false);
    if (failed) return setError(failed);
    toast(t("terminal.marked"));
    onClose();
    router.refresh();
  }

  return (
    <form className="tt-prodform" onSubmit={e => void save(e)}>
      <p className="tt-muted tt-costs-hint">{t("terminal.markHint", { amount: formatMoney(day.expected, currency) })}</p>
      <label className="tt-field">
        <span className="tt-mod-label">{t("terminal.receivedLabel")}</span>
        <input className="tt-input" inputMode="decimal" value={received} onChange={e => setReceived(e.target.value)} required autoFocus />
      </label>
      <label className="tt-field">
        <span className="tt-mod-label">{t("terminal.note")} <span className="tt-muted">{t("common.optional")}</span></span>
        <input className="tt-input" value={note} maxLength={140} onChange={e => setNote(e.target.value)} />
      </label>
      {error && <p className="tt-field-error" role="alert">{error}</p>}
      <div className="tt-prodform-actions">
        <button type="submit" className="tt-btn tt-btn-primary" disabled={busy || !received}>
          {busy ? t("common.saving") : t("terminal.mark")}
        </button>
        <button type="button" className="tt-btn tt-btn-ghost" onClick={onClose}>{t("common.cancel")}</button>
      </div>
    </form>
  );
}
