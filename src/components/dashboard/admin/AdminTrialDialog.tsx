"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";

interface AdminTrialDialogProps {
  name: string;
  /** The trial's current end, ISO. */
  endsAt: string | null;
  busy: boolean;
  onClose: () => void;
  /** A yyyy-mm-dd to extend to, or null to end the trial now. */
  onConfirm: (endsAt: string | null) => void;
}

const dayFromNow = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Extend a restaurant's trial to a date, or end it now (it drops to Carta). */
export default function AdminTrialDialog({ name, endsAt, busy, onClose, onConfirm }: AdminTrialDialogProps) {
  const t = useT();
  const [mode, setMode] = useState<"extend" | "end">("extend");
  const [date, setDate] = useState(endsAt && endsAt.slice(0, 10) > dayFromNow(1) ? endsAt.slice(0, 10) : dayFromNow(14));

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    // End of that day in Mexico City.
    onConfirm(mode === "end" ? null : `${date}T23:59:00-06:00`);
  }

  return (
    <Modal open onClose={onClose} maxWidth={460} title={t("adminTrial.title", { name })}>
      <form className="tt-prodform" onSubmit={submit}>
        <label className="tt-field">
          <span className="tt-mod-label">{t("adminTrial.action")}</span>
          <select className="tt-input" value={mode} onChange={e => setMode(e.target.value as "extend" | "end")}>
            <option value="extend">{t("adminTrial.extend")}</option>
            <option value="end">{t("adminTrial.end")}</option>
          </select>
        </label>
        {mode === "extend" ? (
          <label className="tt-field">
            <span className="tt-mod-label">{t("adminTrial.until")}</span>
            <input className="tt-input" type="date" required value={date} min={dayFromNow(1)} max={dayFromNow(89)}
              onChange={e => setDate(e.target.value)} />
          </label>
        ) : (
          <p className="tt-muted" style={{ margin: 0, fontSize: 13 }}>{t("adminTrial.endBody")}</p>
        )}
        <div className="tt-prodform-actions">
          <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className={`tt-btn tt-btn-sm ${mode === "end" ? "tt-btn-danger" : "tt-btn-primary"}`} disabled={busy}>
            {busy ? t("common.saving") : mode === "end" ? t("adminTrial.endConfirm") : t("adminTrial.extendConfirm")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
